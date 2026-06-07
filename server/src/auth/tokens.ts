import jwt from 'jsonwebtoken'

const SECRET = process.env.JWT_SECRET ?? 'beeurei-dev-secret-change-me'

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
