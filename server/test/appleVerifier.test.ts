import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto'
import { createAppleVerifier } from '../src/auth/apple'

/// Sign in with Apple 验证器的**真实密码学**测试：真 RSA 密钥对 + 真本地 JWKS HTTP 服务 +
/// 真 RS256 签名（node:crypto），逐一验证每个拒绝分支——这是登录边界，任何一个分支失守
/// 都是账号接管向量（alg 混淆/aud 混淆/过期令牌/签名篡改）。此前该文件覆盖率 17.6%：
/// 验签逻辑一行都没被测过，全靠"看起来对"。
const AUD = 'com.hikosphere.beeurei'
const ISS = 'https://appleid.apple.com'

// —— 真实 RSA 密钥对 ×2（k1 常规、k2 模拟 Apple 轮换后的新钥）——
const kp1 = generateKeyPairSync('rsa', { modulusLength: 2048 })
const kp2 = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwkOf = (pub: KeyObject, kid: string) => ({ ...(pub.export({ format: 'jwk' }) as object), kid, use: 'sig', alg: 'RS256' })

const b64u = (s: string) => Buffer.from(s).toString('base64url')
/// 造真签名的 JWT（RS256）；可注入非常规 header/篡改载荷来打各拒绝分支。
function makeToken(payload: Record<string, unknown>, o?: { kid?: string; alg?: string; key?: KeyObject; tamper?: boolean }) {
  const h = b64u(JSON.stringify({ alg: o?.alg ?? 'RS256', kid: o?.kid ?? 'k1' }))
  const p = b64u(JSON.stringify(payload))
  const sig = cryptoSign('RSA-SHA256', Buffer.from(`${h}.${p}`), o?.key ?? kp1.privateKey).toString('base64url')
  if (o?.tamper) {
    // 签名后再改载荷（提权攻击的最小模型：换 sub 冒充他人）——验签必须失败。
    const p2 = b64u(JSON.stringify({ ...payload, sub: 'attacker' }))
    return `${h}.${p2}.${sig}`
  }
  return `${h}.${p}.${sig}`
}
const validClaims = (over?: Record<string, unknown>) => ({
  iss: ISS, aud: AUD, exp: Math.floor(Date.now() / 1000) + 600,
  sub: 'apple-sub-001', email: 'u@example.com', email_verified: 'true', ...over,
})

// —— 真本地 JWKS 服务（node:http，端口 0）：可换钥集、可打故障、计请求数 ——
let jwksServer: Server
let jwksUrl = ''
let servedKeys: object[] = [jwkOf(kp1.publicKey, 'k1')]
let jwksStatus = 200
let jwksHits = 0

beforeAll(async () => {
  jwksServer = createServer((_req, res) => {
    jwksHits++
    res.writeHead(jwksStatus, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ keys: servedKeys }))
  })
  await new Promise<void>((r) => jwksServer.listen(0, '127.0.0.1', r))
  const addr = jwksServer.address() as { port: number }
  jwksUrl = `http://127.0.0.1:${addr.port}/auth/keys`
})
afterAll(async () => { await new Promise((r) => jwksServer.close(r)) })

describe('createAppleVerifier：真 RS256 验签 + 声明校验（登录边界）', () => {
  it('合法令牌 → 返回身份（sub/email/emailVerified 字符串 "true" 归一为布尔）', async () => {
    const verify = createAppleVerifier(AUD, { jwksUrl })
    const id = await verify(makeToken(validClaims()))
    expect(id).toEqual({ sub: 'apple-sub-001', email: 'u@example.com', emailVerified: true })
  })

  it('email_verified 布尔 true 同样归一；"false"/缺失 → emailVerified:false（并号闸门不误开）', async () => {
    const verify = createAppleVerifier(AUD, { jwksUrl })
    expect((await verify(makeToken(validClaims({ email_verified: true }))))?.emailVerified).toBe(true)
    expect((await verify(makeToken(validClaims({ email_verified: 'false' }))))?.emailVerified).toBe(false)
    expect((await verify(makeToken(validClaims({ email_verified: undefined }))))?.emailVerified).toBe(false)
  })

  it('签名篡改（签后换 sub 冒充他人）→ null；alg 混淆（none/HS256 头）→ null', async () => {
    const verify = createAppleVerifier(AUD, { jwksUrl })
    expect(await verify(makeToken(validClaims(), { tamper: true }))).toBeNull()
    expect(await verify(makeToken(validClaims(), { alg: 'none' }))).toBeNull()
    expect(await verify(makeToken(validClaims(), { alg: 'HS256' }))).toBeNull()
  })

  it('aud 混淆（别家 App 的 Apple 令牌）→ null；aud 数组含本 App → 通过', async () => {
    const verify = createAppleVerifier(AUD, { jwksUrl })
    expect(await verify(makeToken(validClaims({ aud: 'com.other.app' })))).toBeNull()
    expect(await verify(makeToken(validClaims({ aud: ['com.other.app', AUD] })))).not.toBeNull()
  })

  it('iss 非 Apple → null；过期 → null；sub 缺失/空 → null；格式非 3 段 → null', async () => {
    const verify = createAppleVerifier(AUD, { jwksUrl })
    expect(await verify(makeToken(validClaims({ iss: 'https://evil.example' })))).toBeNull()
    expect(await verify(makeToken(validClaims({ exp: Math.floor(Date.now() / 1000) - 10 })))).toBeNull()
    expect(await verify(makeToken(validClaims({ sub: '' })))).toBeNull()
    expect(await verify(makeToken(validClaims({ sub: undefined })))).toBeNull()
    expect(await verify('not.a-jwt')).toBeNull()
  })

  it('JWKS 缓存：连续验证只拉一次；JWKS 5xx → 返回 null（登录失败而非 500 泄栈）', async () => {
    const verify = createAppleVerifier(AUD, { jwksUrl })
    const before = jwksHits
    await verify(makeToken(validClaims()))
    await verify(makeToken(validClaims()))
    expect(jwksHits - before).toBe(1)
    jwksStatus = 503
    try {
      const cold = createAppleVerifier(AUD, { jwksUrl }) // 新实例=无缓存，必须现拉
      expect(await cold(makeToken(validClaims()))).toBeNull()
    } finally { jwksStatus = 200 }
  })

  it('Apple 轮换签名钥：kid 未命中→冷却期外强制刷新拿新钥（否则旧缓存 1h 内拒掉所有新登录）', async () => {
    const verify = createAppleVerifier(AUD, { jwksUrl, refetchCooldownMs: 0 })
    expect(await verify(makeToken(validClaims()))).not.toBeNull() // 用 k1 灌热缓存
    servedKeys = [jwkOf(kp2.publicKey, 'k2')] // Apple 轮换：JWKS 只剩新钥
    try {
      const id = await verify(makeToken(validClaims(), { kid: 'k2', key: kp2.privateKey }))
      expect(id?.sub).toBe('apple-sub-001') // 未到 1h 缓存期也拿到了新钥
    } finally { servedKeys = [jwkOf(kp1.publicKey, 'k1')] }
  })

  it('伪造 kid 风暴：冷却期内 kid 未命中**不**触发重复拉取（不被当成打 Apple 的放大器）', async () => {
    const verify = createAppleVerifier(AUD, { jwksUrl }) // 默认冷却 60s
    await verify(makeToken(validClaims())) // 灌热缓存
    const before = jwksHits
    for (let i = 0; i < 5; i++) expect(await verify(makeToken(validClaims(), { kid: `bogus-${i}` }))).toBeNull()
    expect(jwksHits - before).toBe(0) // 五次伪 kid，零次外呼
  })
})
