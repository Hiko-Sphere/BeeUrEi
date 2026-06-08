import jwt from 'jsonwebtoken'
import { randomBytes, createHash } from 'node:crypto'

// 安全：绝不使用硬编码兜底密钥——否则生产漏配 JWT_SECRET 时会用仓库里公开的字符串签发/校验 JWT，
// 攻击者可据此伪造任意用户/admin 令牌绕过全部 RBAC（见审查 #3）。缺失即拒绝启动（fail-closed）。
const SECRET = process.env.JWT_SECRET
  ?? (process.env.NODE_ENV === 'test' ? 'test-only-secret-not-for-production-0123456789' : '')
if (!SECRET || SECRET.length < 16) {
  throw new Error('JWT_SECRET 未配置或过短：生产环境必须设置足够长（≥16）的随机密钥')
}

/// refresh token 有效期（30 天）。
export const refreshTtlMs = 30 * 24 * 60 * 60 * 1000

/// 生成不透明 refresh token（仅哈希入库，原文只给客户端一次）。
export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface TokenPayload {
  sub: string
  role: string
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '1h' })
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as jwt.JwtPayload
    if (typeof decoded.sub !== 'string' || typeof decoded.role !== 'string') return null
    return { sub: decoded.sub, role: decoded.role }
  } catch {
    return null
  }
}
