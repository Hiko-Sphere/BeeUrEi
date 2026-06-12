import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type Role, type User, publicUser } from '../db/store'
import { hashPassword, verifyPassword } from '../auth/passwords'
import { signAccessToken, generateRefreshToken, hashToken, refreshTtlMs } from '../auth/tokens'
import { normalizePhone, type AppleTokenVerifier } from '../auth/apple'

/// 签发 access + refresh 一对（refresh 仅存哈希）。
function issueTokens(store: Store, user: User): { token: string; refreshToken: string } {
  const token = signAccessToken({ sub: user.id, role: user.role, tv: user.tokenVersion ?? 0 })
  const refreshToken = generateRefreshToken()
  store.createRefreshToken({ tokenHash: hashToken(refreshToken), userId: user.id, expiresAt: Date.now() + refreshTtlMs })
  return { token, refreshToken }
}

const refreshSchema = z.object({ refreshToken: z.string().min(1) })

const registerSchema = z.object({
  username: z.string().trim().min(3).max(32), // 去首尾空白，避免" alice"/"alice"混淆（见审查 #4）
  password: z.string().min(6).max(128),
  displayName: z.string().min(1).max(64).optional(),
  // 自助注册仅限这些角色；admin/developer 由后台分配。
  role: z.enum(['blind', 'helper', 'family']).optional(),
  language: z.string().min(2).max(8).optional(), // 协助者/亲友语言，用于匹配排序（见审查 #10）
  email: z.string().email().max(254).optional(), // 可选邮箱：便于日后找回密码（D1）
  phone: z.string().trim().min(6).max(20).optional(), // 可选手机号：可用手机号+密码登录
})

const loginSchema = z.object({
  username: z.string().trim(), // 登录标识：用户名或手机号（字段名保持 username 兼容旧客户端）
  password: z.string(),
})

const appleSchema = z.object({
  identityToken: z.string().min(1),
  displayName: z.string().min(1).max(64).optional(), // Apple 仅首次授权给姓名，客户端透传
  role: z.enum(['blind', 'helper', 'family']).optional(),
  language: z.string().min(2).max(8).optional(),
})

export function registerAuthRoutes(app: FastifyInstance, store: Store, appleVerifier?: AppleTokenVerifier): void {
  // 注册/登录/refresh 是凭证暴破与刷号的高危端点，给独立且更严格的限流（防口令暴破/凭证填充/批量刷号，见审查 #3）。
  app.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
    }
    const { username, password, displayName, role, language, email, phone } = parsed.data
    if (store.findByUsername(username)) {
      return reply.code(409).send({ error: 'username_taken' })
    }
    // 规范化邮箱 + 唯一性（邮箱是账号身份锚，见审查 #13）。
    const normEmail = email?.trim().toLowerCase()
    if (normEmail && store.allUsers().some((u) => (u.email ?? '').toLowerCase() === normEmail)) {
      return reply.code(409).send({ error: 'email_taken' })
    }
    // 手机号归一化 + 唯一性（手机号也是登录标识，与用户名同等对待）。
    let normPhone: string | undefined
    if (phone) {
      const p = normalizePhone(phone)
      if (!p) return reply.code(400).send({ error: 'invalid_phone' })
      if (store.findByPhone(p)) return reply.code(409).send({ error: 'phone_taken' })
      normPhone = p
    }
    const user: User = {
      id: randomUUID(),
      username,
      passwordHash: hashPassword(password),
      displayName: displayName ?? username,
      role: (role ?? 'blind') as Role,
      status: 'active',
      createdAt: Date.now(),
      language,
      email: normEmail,
      emailVerified: normEmail ? false : undefined,
      phone: normPhone,
    }
    store.createUser(user)
    const tokens = issueTokens(store, user)
    return reply.code(201).send({ ...tokens, user: publicUser(user) })
  })

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' })
    }
    // 登录标识兼容用户名与手机号：先按用户名查，再按归一化手机号查。
    const identifier = parsed.data.username
    const byPhone = (): User | undefined => {
      const p = normalizePhone(identifier)
      return p ? store.findByPhone(p) : undefined
    }
    const user = store.findByUsername(identifier) ?? byPhone()
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    if (user.status === 'disabled') {
      return reply.code(403).send({ error: 'account_disabled' })
    }
    const tokens = issueTokens(store, user)
    return reply.send({ ...tokens, user: publicUser(user) })
  })

  // Sign in with Apple：客户端送 identityToken，服务端验签（Apple JWKS + iss/aud/exp）后按 sub 登录/建号。
  // 未配置 APPLE_BUNDLE_ID 时明确返回 503（而非假装成功），与登录同级限流防刷。
  app.post('/api/auth/apple', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!appleVerifier) return reply.code(503).send({ error: 'apple_login_not_configured' })
    const parsed = appleSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const identity = await appleVerifier(parsed.data.identityToken)
    if (!identity) return reply.code(401).send({ error: 'invalid_apple_token' })

    let user = store.findByAppleSub(identity.sub)
    if (!user) {
      // 新 Apple 用户自动建号：生成不冲突的用户名（可日后在账号页修改）。
      let username = `apple_${identity.sub.slice(-8)}`
      while (store.findByUsername(username)) username = `apple_${randomUUID().slice(0, 8)}`
      user = {
        id: randomUUID(),
        username,
        // 随机密码占位（Apple 用户走 Apple 登录；如需密码登录可用找回流程设置）。
        passwordHash: hashPassword(generateRefreshToken()),
        displayName: parsed.data.displayName ?? 'Apple 用户',
        role: (parsed.data.role ?? 'blind') as Role,
        status: 'active',
        createdAt: Date.now(),
        language: parsed.data.language,
        email: identity.email?.toLowerCase(),
        emailVerified: identity.email ? true : undefined, // Apple 已验证过邮箱
        appleSub: identity.sub,
      }
      store.createUser(user)
      const tokens = issueTokens(store, user)
      return reply.code(201).send({ ...tokens, user: publicUser(user) })
    }
    if (user.status === 'disabled') {
      return reply.code(403).send({ error: 'account_disabled' })
    }
    const tokens = issueTokens(store, user)
    return reply.send({ ...tokens, user: publicUser(user) })
  })

  // 用 refresh token 换新的一对 token（轮换：旧 refresh 立即作废）。
  app.post('/api/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const hash = hashToken(parsed.data.refreshToken)
    const rt = store.findRefreshToken(hash)
    if (!rt || rt.expiresAt < Date.now()) {
      if (rt) store.deleteRefreshToken(hash)
      return reply.code(401).send({ error: 'invalid_refresh_token' })
    }
    const user = store.findById(rt.userId)
    if (!user || user.status === 'disabled') {
      store.deleteRefreshToken(hash)
      return reply.code(401).send({ error: 'invalid_refresh_token' })
    }
    store.deleteRefreshToken(hash) // 轮换
    const tokens = issueTokens(store, user)
    return reply.send({ ...tokens, user: publicUser(user) })
  })

  // 登出：撤销该 refresh token。
  app.post('/api/auth/logout', async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    store.deleteRefreshToken(hashToken(parsed.data.refreshToken))
    return reply.code(204).send()
  })
}
