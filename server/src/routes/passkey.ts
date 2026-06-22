import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { type Store, type User, type Passkey, selfView } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { signAccessToken, generateRefreshToken, hashToken, refreshTtlMs } from '../auth/tokens'

// RP（依赖方）配置：必须与 iOS Associated Domains 的 webcredentials 域一致，且该域需托管
// apple-app-site-association 文件。默认 beeurei-api.hikosphere.com——API 子域由本服务直接
// 提供 /.well-known/apple-app-site-association（见 app.ts），不依赖根域站点配合；
// 根域 hikosphere.com 是独立主页，托管不了 AASA（可用 PASSKEY_RP_* 环境变量覆盖）。
const rpID = process.env.PASSKEY_RP_ID?.trim() || 'beeurei-api.hikosphere.com'
const rpName = process.env.PASSKEY_RP_NAME?.trim() || 'BeeUrEi'
// iOS passkey 的 clientDataJSON.origin 为 https://<关联域>。允许逗号分隔多个。
const expectedOrigins = (process.env.PASSKEY_RP_ORIGIN?.trim() || `https://${rpID}`)
  .split(',').map((s) => s.trim()).filter(Boolean)

/// 短时效挑战登记（内存，5 分钟）：注册按 userId，登录按随机 flowId。取出即焚（防重放）。
class ChallengeStore {
  private map = new Map<string, { challenge: string; expiresAt: number }>()
  set(key: string, challenge: string, ttlMs = 5 * 60_000): void {
    this.map.set(key, { challenge, expiresAt: Date.now() + ttlMs })
  }
  take(key: string): string | undefined {
    const e = this.map.get(key)
    this.map.delete(key)
    if (!e || e.expiresAt < Date.now()) return undefined
    return e.challenge
  }
}

function issueTokens(store: Store, user: User): { token: string; refreshToken: string } {
  const token = signAccessToken({ sub: user.id, role: user.role, tv: user.tokenVersion ?? 0 })
  const refreshToken = generateRefreshToken()
  store.createRefreshToken({ tokenHash: hashToken(refreshToken), userId: user.id, expiresAt: Date.now() + refreshTtlMs })
  return { token, refreshToken }
}

/// Passkey（WebAuthn）注册与登录。用 @simplewebauthn/server 做权威验签。
/// iOS 端用 ASAuthorizationPlatformPublicKeyCredentialProvider，把各字段 base64url 编码后回传。
export function registerPasskeyRoutes(app: FastifyInstance, store: Store): void {
  const challenges = new ChallengeStore()

  // 注册：生成 options（authed）。
  app.post('/api/auth/passkey/register/options', { preHandler: requireAuth() }, async (req, reply) => {
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    const existing = store.passkeysForUser(user.id)
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.username,
      userDisplayName: user.displayName,
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.credentialId })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    })
    challenges.set(`reg:${user.id}`, options.challenge)
    return options
  })

  // 注册：校验并存储凭据（authed）。
  app.post('/api/auth/passkey/register/verify', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = z.object({ response: z.any(), deviceName: z.string().max(64).optional() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    const expectedChallenge = challenges.take(`reg:${user.id}`)
    if (!expectedChallenge) return reply.code(400).send({ error: 'challenge_expired' })
    let verification
    try {
      verification = await verifyRegistrationResponse({
        response: parsed.data.response,
        expectedChallenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: rpID,
        requireUserVerification: false,
      })
    } catch {
      return reply.code(400).send({ error: 'verification_failed' })
    }
    if (!verification.verified || !verification.registrationInfo) {
      return reply.code(400).send({ error: 'verification_failed' })
    }
    const cred = verification.registrationInfo.credential
    if (store.findPasskeyByCredentialId(cred.id)) return reply.code(409).send({ error: 'credential_exists' })
    const passkey: Passkey = {
      id: randomUUID(),
      userId: user.id,
      credentialId: cred.id,
      publicKey: Buffer.from(cred.publicKey).toString('base64url'),
      counter: cred.counter,
      deviceName: parsed.data.deviceName,
      createdAt: Date.now(),
    }
    store.createPasskey(passkey)
    return reply.code(201).send({ ok: true, id: passkey.id })
  })

  // 登录 options（无用户名/可发现凭据）：返回 flowId + options。
  app.post('/api/auth/passkey/login/options', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (_req, reply) => {
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' })
    const flowId = randomUUID()
    challenges.set(`login:${flowId}`, options.challenge)
    return reply.send({ flowId, options })
  })

  // 登录 verify：按 flowId 取挑战 → 按 credentialId 找 passkey → 验签 → 发 token。
  app.post('/api/auth/passkey/login/verify', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = z.object({ flowId: z.string().min(1), response: z.any() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const expectedChallenge = challenges.take(`login:${parsed.data.flowId}`)
    if (!expectedChallenge) return reply.code(400).send({ error: 'challenge_expired' })
    const credId = parsed.data.response?.id
    if (typeof credId !== 'string') return reply.code(400).send({ error: 'invalid_input' })
    const passkey = store.findPasskeyByCredentialId(credId)
    if (!passkey) return reply.code(401).send({ error: 'unknown_credential' })
    const user = store.findById(passkey.userId)
    if (!user) return reply.code(401).send({ error: 'unknown_credential' })
    if (user.status === 'disabled') return reply.code(403).send({ error: 'account_disabled' })
    let verification
    try {
      verification = await verifyAuthenticationResponse({
        response: parsed.data.response,
        expectedChallenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: rpID,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')),
          counter: passkey.counter,
        },
        requireUserVerification: false,
      })
    } catch {
      return reply.code(401).send({ error: 'verification_failed' })
    }
    if (!verification.verified) return reply.code(401).send({ error: 'verification_failed' })
    store.updatePasskeyCounter(passkey.id, verification.authenticationInfo.newCounter)
    const tokens = issueTokens(store, user)
    return reply.send({ ...tokens, user: selfView(user) })
  })

  // 列出我的 passkey（账号管理）。
  app.get('/api/auth/passkey/list', { preHandler: requireAuth() }, async (req) => {
    const list = store.passkeysForUser(req.user!.sub)
      .map((p) => ({ id: p.id, deviceName: p.deviceName ?? null, createdAt: p.createdAt }))
    return { passkeys: list }
  })

  // 删除一把 passkey（仅本人）。
  app.delete('/api/auth/passkey/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    store.deletePasskey(id, req.user!.sub)
    return reply.code(204).send()
  })
}
