import { randomUUID } from 'node:crypto'
import type { Store, User } from '../db/store'
import type { PushSender } from '../push/apns'
import { notifyNewDeviceLogin } from '../notifications/notify'
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

/// 登录（**非**续期）签发：建新会话前先看本人是否已有其它活跃会话。若这次登录来自一台此前没登录过的设备
/// （既有活跃会话里没有相同 deviceLabel），即时预警本人「账号有新设备登录」——Apple/Google/银行式接管早期信号。
/// 与 issueTokens 分开：续期(refresh)走 issueTokens（带 sid、绝不预警）；本函数只给「新登录」（含注册后首登）。
/// 首登/全登出后重登（无其它活跃会话）→ 不报（prior 为空）；同设备重登（既有会话 deviceLabel 相同）→ 不报，只报「另一台设备」。
export function issueLoginTokens(store: Store, push: PushSender, user: User, deviceLabel?: string): { token: string; refreshToken: string } {
  const prior = store.sessionsForUser(user.id, Date.now()) // 建会话**前**的既有活跃会话（本次的还没写入）
  const tokens = issueTokens(store, user, { deviceLabel })
  if (prior.length > 0 && !prior.some((s) => s.deviceLabel === deviceLabel)) {
    notifyNewDeviceLogin(store, push, user, deviceLabel)
  }
  return tokens
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
