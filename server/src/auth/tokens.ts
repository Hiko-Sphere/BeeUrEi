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
  tv?: number // tokenVersion：与库中用户的 tokenVersion 比对；改密/封禁递增即令旧 access token 立即失效（见审查 #1/#2）
  sid?: string // 会话 ID：标识这台设备的登录会话，跨 refresh 轮换保持不变。用于「登录设备」列表与按设备远程登出（撤销该会话即令其 access token 立即失效）。
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '1h' })
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as jwt.JwtPayload
    if (typeof decoded.sub !== 'string' || typeof decoded.role !== 'string') return null
    const tv = typeof decoded.tv === 'number' ? decoded.tv : 0
    const sid = typeof decoded.sid === 'string' ? decoded.sid : undefined
    return { sub: decoded.sub, role: decoded.role, tv, sid }
  } catch {
    return null
  }
}

/// 短时媒体播放令牌：用于无法携带 Authorization 头的场景（Web `<video src>`）。
/// 严格作用域：绑定到单个 recordingId + 单个用户 + 其角色 + 其 tokenVersion，短时过期，
/// 签名不可伪造/挪用到其它录制；tv 让"改密/封禁/强制下线"(递增 tokenVersion)即时使令牌失效。
export const MEDIA_TOKEN_TTL_SEC = 60 // 唯一真源：jwt 过期与对客户端公布的 expiresInSec 都从此派生
export interface MediaTokenPayload { sub: string; role: string; rec: string; tv: number }
export function signMediaToken(payload: MediaTokenPayload): string {
  return jwt.sign({ ...payload, scope: 'media' }, SECRET, { expiresIn: MEDIA_TOKEN_TTL_SEC })
}
export function verifyMediaToken(token: string, recordingId: string): MediaTokenPayload | null {
  try {
    const d = jwt.verify(token, SECRET) as jwt.JwtPayload
    if (d.scope !== 'media' || d.rec !== recordingId) return null
    if (typeof d.sub !== 'string' || typeof d.role !== 'string') return null
    const tv = typeof d.tv === 'number' ? d.tv : 0
    return { sub: d.sub, role: d.role, rec: d.rec, tv }
  } catch {
    return null
  }
}
