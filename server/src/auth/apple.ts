import { createPublicKey, verify as cryptoVerify } from 'node:crypto'

/// Sign in with Apple 的 identityToken 验证。
/// 验证器以函数注入路由（测试注入 fake，离线可测）；真实实现拉取 Apple JWKS 验签。
export interface AppleIdentity {
  sub: string // Apple 的稳定用户标识（同一 App 下不变）
  email?: string
  emailVerified?: boolean // Apple 的 email_verified 声明（'true'/true 即已验证）；仅据此自动并号
}
export type AppleTokenVerifier = (identityToken: string) => Promise<AppleIdentity | null>

const APPLE_ISS = 'https://appleid.apple.com'
const JWKS_URL = 'https://appleid.apple.com/auth/keys'

/// 真实验证器：RS256 验签（Apple JWKS，按 kid 选钥，缓存 1 小时）+ iss/aud/exp 校验。
/// audience 必须是 App 的 bundle id（APPLE_BUNDLE_ID）——否则任何 App 的 Apple token 都能登入本服务。
/// opts 仅供测试/特殊部署注入 JWKS 地址与轮换刷新冷却——生产默认打 Apple 真实端点。
export function createAppleVerifier(
  audience: string,
  opts?: { jwksUrl?: string; refetchCooldownMs?: number },
): AppleTokenVerifier {
  const jwksUrl = opts?.jwksUrl ?? JWKS_URL
  const refetchCooldownMs = opts?.refetchCooldownMs ?? 60_000
  let jwksCache: { keys: any[]; fetchedAt: number } | null = null

  async function fetchJwks(): Promise<any[]> {
    // 硬超时：Apple JWKS 慢/挂时，裸 fetch 会无限期挂住登录请求（无缓存的首个 Apple 登录尤甚）。
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    let res: Response
    try { res = await fetch(jwksUrl, { signal: ctrl.signal }) } finally { clearTimeout(timer) }
    if (!res.ok) throw new Error(`jwks_fetch_failed_${res.status}`)
    const body = (await res.json()) as { keys: any[] }
    jwksCache = { keys: body.keys ?? [], fetchedAt: Date.now() }
    return jwksCache.keys
  }

  async function jwks(): Promise<any[]> {
    if (jwksCache && Date.now() - jwksCache.fetchedAt < 3_600_000) return jwksCache.keys
    return fetchJwks()
  }

  return async (identityToken: string): Promise<AppleIdentity | null> => {
    try {
      const parts = identityToken.split('.')
      if (parts.length !== 3) return null
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
      if (header.alg !== 'RS256') return null
      let key = (await jwks()).find((k) => k.kid === header.kid)
      if (!key && jwksCache && Date.now() - jwksCache.fetchedAt >= refetchCooldownMs) {
        // kid 未命中：Apple 轮换签名钥时旧缓存最长 1 小时会拒掉**所有**新 Apple 登录——
        // 强制刷新一次再找（冷却 60s 防伪造 kid 的令牌风暴把我们变成打 Apple 的放大器）。
        key = (await fetchJwks()).find((k) => k.kid === header.kid)
      }
      if (!key) return null
      const pub = createPublicKey({ key, format: 'jwk' })
      const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`),
                              pub, Buffer.from(parts[2], 'base64url'))
      if (!ok) return null
      if (payload.iss !== APPLE_ISS) return null
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
      if (!aud.includes(audience)) return null
      if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
      if (typeof payload.sub !== 'string' || !payload.sub) return null
      // Apple 的 email_verified 可能是布尔或字符串 'true'/'false'。
      const ev = payload.email_verified
      const emailVerified = ev === true || ev === 'true'
      return {
        sub: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        emailVerified,
      }
    } catch {
      return null
    }
  }
}

/// 手机号归一化：去空格/横线/括号/点分隔（"305.555.0199" 等国际常见写法），允许前导 +，6–15 位数字。非法返回 null。
export function normalizePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s().-]/g, '')
  if (!/^\+?\d{6,15}$/.test(cleaned)) return null
  return cleaned
}
