import { apiURL } from './config'

// ---------- 模型（与服务端对齐） ----------
export interface User { id: string; username: string; displayName: string; role: string; status: string; avatar?: string | null; verified?: boolean }
export interface SelfView extends User { language?: string | null; email?: string | null; emailVerified?: boolean; phone?: string | null; usernameCustomized?: boolean; appleLinked?: boolean; twoFactorEnabled?: boolean }
export interface VerificationStatusInfo {
  status: 'none' | 'pending' | 'verified' | 'rejected'
  idType?: string
  attempt?: number
  submittedAt?: number
  decidedAt?: number
  rejectReasonCode?: string
  rejectReasonNote?: string
  docsUploaded?: string[]
  canResubmit?: boolean
}
export interface SessionInfo { sessionId: string; deviceLabel?: string; createdAt?: number; lastSeenAt?: number; expiresAt: number; current: boolean }
export interface IncomingLink { id: string; ownerId: string; ownerName: string; ownerAvatar?: string | null; relation: string; isEmergency?: boolean; status?: string }
export interface FamilyLink { id: string; memberId: string; memberName: string; memberAvatar?: string | null; relation: string; isEmergency: boolean; phone?: string | null; status?: string; outgoing?: boolean }
export interface CallRecordInfo { id: string; callId: string; direction?: string; status: string; peerName?: string; peerAvatar?: string | null; createdAt: number }
export interface IceServer { urls: string[] | string; username?: string; credential?: string }
export interface IncomingCall { callId: string; fromName: string; fromUserId: string; fromAvatar?: string | null }
export interface HelpRequest { callId: string; requesterName?: string; fromName?: string; fromUserId?: string; createdAt?: number; durationSec?: number; lang?: string }
export interface ChatMessage { id: string; fromId: string; toId: string; kind: string; text: string; createdAt: number; readAt?: number; reaction?: string; groupId?: string }
export interface Conversation { peer: User; last: ChatMessage; unread: number }
export interface ChatGroup { id: string; name: string; ownerId: string; memberIds: string[]; createdAt: number }
export interface GroupSummary { group: ChatGroup; members: User[]; last: ChatMessage | null; unread: number }
export interface RecordingInfo { id: string; callId: string; ownerId: string; ownerName: string; reason: string; recordedAt: number; durationSec?: number | null; lat?: number | null; lon?: number | null; locationLabel?: string | null; participantIds: string[]; participantNames: string[]; hasMedia: boolean; deletedAt?: number | null }
export interface NotificationInfo { id: string; userId: string; kind: string; title: string; body: string; data?: Record<string, string> | null; createdAt: number; readAt?: number | null }
export interface ContactLocation { userId: string; displayName: string; avatar?: string | null; role: string; lat: number; lng: number; accuracy?: number | null; heading?: number | null; updatedAt: number }
export interface AppConfig {
  features: Record<string, boolean>
  registrationEnabled: boolean
  recording: { enabled: boolean; requireConsent: boolean }
  announcement?: { enabled: boolean; text?: string; level?: string } | null
  maintenance?: { enabled: boolean; message?: string } | null
  requireVerification?: boolean
}

export class APIError extends Error {
  code: string
  status: number
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status }
}

/// 把发送/聊天操作错误映射成对用户友好、且**不会让人徒劳重试**的文案（与 iOS 端 ChatStrings.sendErrorText 对齐）。
/// feature_disabled/maintenance/content_blocked 等是"重试也没用"的状态，必须区别于瞬时失败。
/// t 为 i18n 译函数；fallback 为非已知码时的兜底文案。
export function chatErrorText(err: unknown, t: (zh: string, en: string) => string, fallback?: string): string {
  const code = err instanceof APIError ? err.code : ''
  switch (code) {
    case 'feature_disabled': return t('聊天功能已被管理员暂时关闭', 'Messaging is currently turned off by the administrator')
    case 'maintenance': return t('系统维护中，请稍后再试', 'Under maintenance — please try again later')
    case 'content_blocked': return t('消息含被禁止的内容，未发送', "Message contains blocked content and wasn't sent")
    case 'message_too_long': return t('消息太长，请缩短后再发', 'Message is too long — please shorten it')
    case 'blocked': return t('你们之间存在拉黑，无法发送', "Can't send — one of you blocked the other")
    case 'not_linked': return t('对方已不是你的联系人，无法发送', 'This person is no longer your contact')
    case 'not_member': return t('你已不在该群聊中', "You're no longer in this group")
    case 'media_too_large': return t('视频太大（上限 50MB），请选短一点的', 'Video too large (50MB max) — pick a shorter one')
    case 'unsupported_media_type': return t('不支持的文件格式', 'Unsupported file type')
    default: return fallback ?? t('发送失败', 'Failed to send')
  }
}

const LS_TOKEN = 'beeurei.web.token'
const LS_REFRESH = 'beeurei.web.refresh'
const LS_USER = 'beeurei.web.user'

export const tokenStore = {
  get token() { return localStorage.getItem(LS_TOKEN) },
  get refresh() { return localStorage.getItem(LS_REFRESH) },
  get user(): User | null { try { return JSON.parse(localStorage.getItem(LS_USER) || 'null') } catch { return null } },
  set(token: string, refresh: string, user: User) {
    localStorage.setItem(LS_TOKEN, token); localStorage.setItem(LS_REFRESH, refresh); localStorage.setItem(LS_USER, JSON.stringify(user))
  },
  setUser(user: User) { localStorage.setItem(LS_USER, JSON.stringify(user)) },
  clear() { localStorage.removeItem(LS_TOKEN); localStorage.removeItem(LS_REFRESH); localStorage.removeItem(LS_USER) },
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn }

async function rawFetch(method: string, path: string, body: unknown, auth: boolean, retry = true): Promise<unknown> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (auth && tokenStore.token) headers['authorization'] = 'Bearer ' + tokenStore.token
  let res: Response
  try {
    res = await fetch(apiURL(path), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  } catch { throw new APIError('network', 0) }
  if (res.status === 401 && auth && retry) {
    // 尝试用 refresh 续期一次。
    if (await tryRefresh()) return rawFetch(method, path, body, auth, false)
    tokenStore.clear(); onUnauthorized?.()
    throw new APIError('unauthorized', 401)
  }
  let data: unknown = null
  try { data = await res.json() } catch { /* 204 等空体 */ }
  if (!res.ok) {
    const code = (data && typeof data === 'object' && 'error' in data) ? String((data as { error: unknown }).error) : `http_${res.status}`
    throw new APIError(code, res.status)
  }
  return data
}

let refreshing: Promise<boolean> | null = null
async function tryRefresh(): Promise<boolean> {
  const rt = tokenStore.refresh
  if (!rt) return false
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      const r = await fetch(apiURL('/api/auth/refresh'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) })
      if (!r.ok) return false
      const j = await r.json() as { token?: string; refreshToken?: string }
      if (!j.token) return false
      localStorage.setItem(LS_TOKEN, j.token)
      if (j.refreshToken) localStorage.setItem(LS_REFRESH, j.refreshToken)
      return true
    } catch { return false }
    finally { refreshing = null }
  })()
  return refreshing
}

const get = (p: string) => rawFetch('GET', p, undefined, true)
const post = (p: string, b?: unknown) => rawFetch('POST', p, b, true)
const del = (p: string) => rawFetch('DELETE', p, undefined, true)

// ---------- API ----------
export const api = {
  // 认证
  async login(identifier: string, password: string, totpCode?: string): Promise<{ token: string; refreshToken: string; user: User }> {
    // 标识可为用户名 / 手机号 / 邮箱，后端按字段判定；统一传 username（后端兼容）。
    const body: Record<string, string> = { password }
    if (identifier.includes('@')) body.email = identifier
    else if (/^\+?[0-9]{5,}$/.test(identifier.replace(/[\s-]/g, ''))) body.phone = identifier.replace(/[\s-]/g, '')
    else body.username = identifier
    if (totpCode) body.totpCode = totpCode // 开了两步验证的账号补交 TOTP / 恢复码
    return rawFetch('POST', '/api/auth/login', body, false) as Promise<{ token: string; refreshToken: string; user: User }>
  },
  async register(username: string, password: string, role: string): Promise<{ token: string; refreshToken: string; user: User; created?: boolean }> {
    return rawFetch('POST', '/api/auth/register', { username, password, role }, false) as Promise<{ token: string; refreshToken: string; user: User; created?: boolean }>
  },
  me: async () => ((await get('/api/me')) as { user: SelfView }).user,
  appConfig: () => get('/api/app-config') as Promise<AppConfig>,
  setRole: (role: string) => post('/api/account/role', { role }),
  setProfile: (displayName: string) => post('/api/account/profile', { displayName }),
  setLanguage: (language: string) => post('/api/account/language', { language }),
  setPassword: (oldPassword: string, newPassword: string) => post('/api/account/password', { oldPassword, newPassword }),
  setPhone: (phone: string) => post('/api/account/phone', { phone }),
  setUsername: (username: string) => post('/api/account/username', { username }),
  deleteAccount: () => del('/api/account'),

  // 登录设备 / 会话管理
  sessions: () => get('/api/account/sessions') as Promise<{ sessions: SessionInfo[] }>,
  revokeSession: (sessionId: string) => post('/api/account/sessions/revoke', { sessionId }),
  revokeOtherSessions: () => post('/api/account/sessions/revoke-others'),

  // 两步验证（2FA / TOTP）
  twoFAStatus: () => get('/api/account/2fa') as Promise<{ enabled: boolean; recoveryCodesRemaining: number }>,
  twoFASetup: () => post('/api/account/2fa/setup') as Promise<{ secret: string; otpauthUri: string }>,
  twoFAEnable: (code: string) => post('/api/account/2fa/enable', { code }) as Promise<{ recoveryCodes: string[] }>,
  twoFADisable: (code: string) => post('/api/account/2fa/disable', { code }),
  twoFARecovery: (code: string) => post('/api/account/2fa/recovery-codes', { code }) as Promise<{ recoveryCodes: string[] }>,

  // 实名认证（KYC）
  verificationStatus: () => get('/api/account/verification') as Promise<VerificationStatusInfo>,
  submitVerification: (body: { legalName: string; idType: string; idNumberLast4: string; idNumber?: string; consentVersion: string }) =>
    post('/api/account/verification', body) as Promise<{ status: string; id: string; attempt: number }>,
  withdrawVerification: () => del('/api/account/verification'),

  // 亲友 / 联系人
  incomingLinks: () => get('/api/family/incoming') as Promise<{ links: IncomingLink[] }>,
  familyLinks: () => get('/api/family/links') as Promise<{ links: FamilyLink[] }>,
  addLink: (target: { username?: string; userId?: string; phone?: string }, relation: string, isEmergency: boolean) =>
    post('/api/family/links', { ...target, relation, isEmergency }),
  acceptLink: (id: string) => post(`/api/family/links/${id}/accept`),
  deleteLink: (id: string) => del(`/api/family/links/${id}`),
  lookupUser: (q: string) => get(`/api/users/lookup?q=${encodeURIComponent(q)}`) as Promise<{ user?: User }>,

  // 拉黑
  blocks: () => get('/api/blocks') as Promise<{ blocks: { id: string; blockedId: string; blockedName?: string }[] }>,
  block: (userId: string) => post('/api/blocks', { userId }),
  unblock: (id: string) => del(`/api/blocks/${id}`),

  // 通话 / 求助
  callHistory: () => get('/api/calls') as Promise<{ calls: CallRecordInfo[] }>,
  iceServers: () => get('/api/assist/turn') as Promise<{ iceServers: IceServer[] }>,
  incomingCalls: () => get('/api/assist/incoming') as Promise<{ calls: IncomingCall[] }>,
  registerCall: (callId: string, targetUserIds: string[]) => post('/api/assist/call', { callId, targetUserIds }),
  cancelCall: (callId: string) => post('/api/assist/call/cancel', { callId }),
  declineCall: (callId: string) => post('/api/assist/call/decline', { callId }),
  answeredCall: (callId: string) => post('/api/assist/call/answered', { callId }) as Promise<{ ok: boolean; answeredBy: string; youWon: boolean }>,
  callStatus: (callId: string) => get(`/api/assist/call/status?callId=${encodeURIComponent(callId)}`) as Promise<{ exists?: boolean; declinedAll?: boolean }>,
  onlineCount: () => get('/api/assist/online-count') as Promise<{ total: number; online: number }>,
  heartbeat: (available = true) => post('/api/assist/heartbeat', { available }),
  helpQueue: () => get('/api/assist/help/queue') as Promise<{ requests: HelpRequest[]; count: number }>,
  claimHelp: (callId: string) => post('/api/assist/help/claim', { callId }) as Promise<{ request: { callId: string; fromName: string; fromAvatar?: string | null; language?: string | null; locality?: string | null; topic?: string | null } }>,

  // 实时位置共享（与亲友/协助者互相可见；纯内存、按已接受绑定授权）
  updateLocation: (body: { lat: number; lng: number; accuracy?: number; heading?: number; ttlSec?: number }) =>
    post('/api/locations/update', body) as Promise<{ ok: boolean; sharingUntil: number }>,
  stopSharingLocation: () => post('/api/locations/stop'),
  contactLocations: () => get('/api/locations/contacts') as Promise<{ sharing: boolean; sharingUntil: number; contacts: ContactLocation[] }>,

  // 录制（知情同意握手 + 创建元数据；策略经 app-config 下发）
  recordingConsent: (callId: string, granted: boolean) => post('/api/recordings/consent', { callId, granted }),
  createRecording: (body: { callId: string; reason?: string; mediaId?: string; durationSec?: number; lat?: number; lon?: number; locationLabel?: string }) =>
    post('/api/recordings', body) as Promise<{ recording: { id: string } }>,

  // 聊天
  conversations: () => get('/api/conversations') as Promise<{ conversations: Conversation[] }>,
  messagesWith: (peerId: string, before?: number) => get(`/api/messages?with=${encodeURIComponent(peerId)}${before ? `&before=${before}` : ''}`) as Promise<{ messages: ChatMessage[] }>,
  groupMessages: (groupId: string, before?: number) => get(`/api/messages?group=${encodeURIComponent(groupId)}${before ? `&before=${before}` : ''}`) as Promise<{ messages: ChatMessage[] }>,
  sendMessage: (target: { toId?: string; groupId?: string }, kind: string, text: string) => post('/api/messages', { ...target, kind, text }) as Promise<{ message: ChatMessage }>,
  markRead: (fromId: string) => post('/api/messages/read', { fromId }),
  markGroupRead: (groupId: string) => post('/api/messages/read', { groupId }),
  recallMessage: (id: string) => post(`/api/messages/${id}/recall`) as Promise<{ message: ChatMessage }>,
  reactMessage: (id: string, emoji: string) => post(`/api/messages/${id}/reaction`, { emoji }) as Promise<{ message: ChatMessage }>,
  groups: () => get('/api/groups') as Promise<{ groups: GroupSummary[] }>,
  createGroup: (name: string, memberIds: string[]) => post('/api/groups', { name, memberIds }),
  addGroupMembers: (id: string, memberIds: string[]) => post(`/api/groups/${id}/members`, { memberIds }),
  leaveGroup: (id: string, userId: string) => del(`/api/groups/${id}/members/${userId}`),
  deleteGroup: (id: string) => del(`/api/groups/${id}`),

  // 录制
  myRecordings: () => get('/api/recordings/mine') as Promise<{ recordings: RecordingInfo[] }>,
  deleteMyRecording: (id: string) => del(`/api/recordings/mine/${id}`),
  recordingPlayToken: (id: string) => get(`/api/recordings/${id}/play-token`) as Promise<{ token: string; expiresInSec: number }>,

  // 通知
  notifications: () => get('/api/notifications') as Promise<{ notifications: NotificationInfo[]; unread: number }>,
  markNotifRead: (id: string) => post(`/api/notifications/${id}/read`),
  markAllNotifsRead: () => post('/api/notifications/read-all'),

  // 举报
  report: (targetUserId: string, reason: string, callId?: string, evidenceRecordingId?: string) =>
    post('/api/reports', { targetUserId, reason, callId, evidenceRecordingId }),

  // —— 管理员（与 iOS / 现有 admin SPA 同源端点）——
  adminOverview: () => get('/api/admin/overview') as Promise<AdminOverview>,
  adminUsers: (q?: { q?: string; role?: string; status?: string; limit?: number }) => {
    const p = new URLSearchParams()
    if (q?.q) p.set('q', q.q)
    if (q?.role) p.set('role', q.role)
    if (q?.status) p.set('status', q.status)
    p.set('limit', String(q?.limit ?? 50))
    return get(`/api/admin/users?${p.toString()}`) as Promise<{ users: AdminUser[]; total: number }>
  },
  adminSetStatus: (id: string, status: 'active' | 'disabled') => post(`/api/admin/users/${id}/status`, { status }),
  adminSetUserRole: (id: string, role: string) => post(`/api/admin/users/${id}/role`, { role }),
  adminReports: () => get('/api/admin/reports') as Promise<{ reports: AdminReport[] }>,
  adminResolveReport: (id: string) => post(`/api/admin/reports/${id}/resolve`),
  adminModerate: (id: string, action: 'dismiss' | 'warn' | 'suspend' | 'ban', reason: string) => post(`/api/admin/reports/${id}/moderate`, { action, reason }),
  adminActiveCalls: () => get('/api/admin/calls/active') as Promise<{ nowMs: number; calls: AdminActiveCall[] }>,
  adminEndCall: (callId: string) => post(`/api/admin/calls/${callId}/end`),
}

export interface AdminOverview {
  users: { total: number; active: number; disabled: number; byRole: Record<string, number> }
  online: { total: number; helpers: number }
  reports: { open: number; total: number }
  recordings: { total: number; config: { enabled: boolean; requireConsent: boolean; retentionDays?: number } }
  growth: { newUsers7d: number; newUsers30d: number; trend: { date: string; count: number }[] }
  version: string
  uptimeSeconds: number
  nowMs: number
}
export interface AdminUser { id: string; username: string; displayName: string; role: string; status: string; avatar?: string | null; createdAt: number; online?: boolean; hasEmail?: boolean; hasPhone?: boolean; emailVerified?: boolean; appleLinked?: boolean }
export interface AdminReport { id: string; reporterId: string; reporterName: string; targetUserId: string; targetName: string; reason: string; status: string; decision?: string | null; callId?: string | null; evidenceRecordingId?: string | null; createdAt: number; resolvedAt?: number | null; resolvedByName?: string | null }
export interface AdminActiveCall { callId: string; startedAt: number; durationSec: number; hasAdminObserver: boolean; members: { userId: string; role: string; name: string; online: boolean }[] }

// 上传媒体（聊天图片/视频/语音）：原始二进制 + content-type。
export async function uploadMedia(blob: Blob, mime: string): Promise<string> {
  const res = await fetch(apiURL('/api/media'), { method: 'POST', headers: { 'content-type': mime, ...(tokenStore.token ? { authorization: 'Bearer ' + tokenStore.token } : {}) }, body: blob })
  if (!res.ok) {
    // 透传服务端错误码（unsupported_media_type / media_too_large / consent_required 等），便于排查与给用户准确反馈。
    let code = 'upload_failed'
    try { const j = await res.json() as { error?: string }; if (j?.error) code = j.error } catch { /* 非 JSON 错误体 */ }
    throw new APIError(code, res.status)
  }
  const j = await res.json() as { media: { id: string } }
  return j.media.id
}

// 媒体 URL（聊天媒体）：带 token 无法走 <img src>；用 blob 拉取后 objectURL。
export async function fetchMediaObjectURL(id: string): Promise<string> {
  const res = await fetch(apiURL(`/api/media/${id}`), { headers: tokenStore.token ? { authorization: 'Bearer ' + tokenStore.token } : {} })
  if (!res.ok) throw new APIError('media_failed', res.status)
  return URL.createObjectURL(await res.blob())
}

// 把用户选的图片经 canvas 重编码为 JPEG（≤2048px 长边）——天然剥离 EXIF/GPS，并控制体积；
// 与服务端的元数据剥离形成纵深防御。失败则抛 image_decode_failed。
export async function reencodeToJpeg(file: File, maxEdge = 2048): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new APIError('image_decode_failed', 0))
      im.src = url
    })
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new APIError('image_decode_failed', 0)
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) throw new APIError('image_decode_failed', 0)
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

// 上传一张实名证件图（原始二进制；服务端会再次嗅探/剥离/加密）。kind: front|back|selfie。
export async function uploadVerificationDoc(id: string, kind: string, blob: Blob): Promise<void> {
  const res = await fetch(apiURL(`/api/account/verification/${encodeURIComponent(id)}/doc/${encodeURIComponent(kind)}`), {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', ...(tokenStore.token ? { authorization: 'Bearer ' + tokenStore.token } : {}) },
    body: blob,
  })
  if (!res.ok) {
    let code = 'upload_failed'
    try { const j = await res.json() as { error?: string }; if (j?.error) code = j.error } catch { /* 非 JSON 错误体 */ }
    throw new APIError(code, res.status)
  }
}
