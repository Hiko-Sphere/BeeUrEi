import { randomUUID } from 'node:crypto'
import type { Store, User } from '../db/store'
import { signAccessToken, generateRefreshToken, hashToken, refreshTtlMs } from './tokens'

/// 签发会话（access + refresh 一对）的共享逻辑：auth.ts 与 passkey.ts 都用它，确保每条登录路径
/// 都带上 sessionId（跨 refresh 轮换保持不变）与设备标签，供「登录设备」列表与按设备远程登出。
export interface SessionContext {
  sid?: string          // 续期(refresh)时传入既有会话 ID 以延续会话；登录/注册不传则新建
  deviceLabel?: string  // 设备友好标签（展示用，非安全）
  createdAt?: number     // 续期时传入会话原始创建时间，保持不变
}

export function issueTokens(store: Store, user: User, ctx: SessionContext = {}): { token: string; refreshToken: string } {
  const sid = ctx.sid ?? randomUUID()
  const now = Date.now()
  const token = signAccessToken({ sub: user.id, role: user.role, tv: user.tokenVersion ?? 0, sid })
  const refreshToken = generateRefreshToken()
  store.createRefreshToken({
    tokenHash: hashToken(refreshToken),
    userId: user.id,
    expiresAt: now + refreshTtlMs,
    sessionId: sid,
    deviceLabel: ctx.deviceLabel,
    createdAt: ctx.createdAt ?? now,
    lastSeenAt: now,
  })
  return { token, refreshToken }
}

/// 从请求头/客户端字段推断设备友好标签（仅展示，绝不用于鉴权）。优先客户端显式名（如 iOS 设备名），否则解析 UA。
export function deviceLabelFromReq(headers: Record<string, unknown>, clientName?: string): string | undefined {
  const name = (clientName ?? '').trim()
  if (name) return name.slice(0, 64)
  const ua = String(headers['user-agent'] ?? '')
  if (!ua) return undefined
  if (/BeeUrEi/i.test(ua)) {
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : 'iOS'
    return `BeeUrEi · ${os}`
  }
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : ''
  const browser = /Edg\//.test(ua) ? 'Edge' : /(CriOS|Chrome)/.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox'
    : /Safari/.test(ua) ? 'Safari' : ''
  const label = [browser, os].filter(Boolean).join(' · ')
  return label || ua.slice(0, 64)
}
