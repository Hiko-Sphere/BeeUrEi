import jwt from 'jsonwebtoken'
import { randomBytes, createHash } from 'node:crypto'

const SECRET = process.env.JWT_SECRET ?? 'beeurei-dev-secret-change-me'

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
