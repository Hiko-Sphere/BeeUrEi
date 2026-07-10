import { apiURL } from './config'

// ---------- 模型（与服务端对齐） ----------
export interface User { id: string; username: string; displayName: string; role: string; status: string; avatar?: string | null; verified?: boolean; online?: boolean }
export interface SelfView extends User { language?: string | null; email?: string | null; emailVerified?: boolean; phone?: string | null; usernameCustomized?: boolean; appleLinked?: boolean; twoFactorEnabled?: boolean; helperGuidelineAckAt?: number | null; legalConsentVersion?: string | null; legalConsentAt?: number | null; readReceiptsEnabled?: boolean }
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
export interface FamilyLink { id: string; memberId: string; memberName: string; memberAvatar?: string | null; relation: string; isEmergency: boolean; amOwner?: boolean; phone?: string | null; status?: string; outgoing?: boolean; online?: boolean }
export interface CallRecordInfo { id: string; callId: string; direction?: string; status: string; peerId?: string | null; peerName?: string; peerAvatar?: string | null; emergency?: boolean; createdAt: number }
export interface IceServer { urls: string[] | string; username?: string; credential?: string }
export interface IncomingCall { callId: string; fromName: string; fromUserId: string; fromAvatar?: string | null; emergency?: boolean }
// 与后端 HelpSummary 对齐：队列对外的安全摘要（不暴露 fromUserId）。
export interface HelpRequest { callId: string; fromName: string; fromAvatar?: string | null; language?: string; locality?: string; topic?: string; waitedSeconds: number }
export interface ChatMessage { id: string; fromId: string; toId: string; kind: string; text: string; createdAt: number; readAt?: number; reaction?: string; groupId?: string; editedAt?: number; replyTo?: string; readBy?: number; readTotal?: number; forwarded?: boolean }
export interface Conversation { peer: User; last: ChatMessage; unread: number; muted?: boolean; online?: boolean }
export interface ChatGroup { id: string; name: string; ownerId: string; memberIds: string[]; createdAt: number }
export interface GroupSummary { group: ChatGroup; members: User[]; last: ChatMessage | null; unread: number; muted?: boolean }
export interface RecordingInfo { id: string; callId: string; ownerId: string; ownerName: string; reason: string; recordedAt: number; durationSec?: number | null; lat?: number | null; lon?: number | null; locationLabel?: string | null; participantIds: string[]; participantNames: string[]; hasMedia: boolean; deletedAt?: number | null }
export interface NotificationInfo { id: string; userId: string; kind: string; title: string; body: string; data?: Record<string, string> | null; createdAt: number; readAt?: number | null }
/// 勿扰时段：分钟-of-day [0,1439] + IANA 时区。start>end 表跨午夜（22:00→07:00）。
export interface QuietHoursInfo { enabled: boolean; startMinute: number; endMinute: number; tz: string }
// 可按类静音的推送横幅类别（与服务端 MUTABLE_CATEGORIES 一致）。危急类不在此列、永不可静音。
export type PushCategory = 'social' | 'route' | 'location'
export interface RouteWaypoint { lat: number; lng: number; note?: string }
/// 路线库条目（坐标全程 WGS-84——编辑器必须用 OSM 瓦片，绝不可换 amap GCJ-02 瓦片，会系统性偏移百米级）。
export interface SavedRouteInfo { id: string; ownerId: string; createdBy: string; name: string; waypoints: RouteWaypoint[]; createdAt: number; updatedAt: number; role: 'owner' | 'creator' }
export interface ContactLocation { userId: string; displayName: string; avatar?: string | null; role: string; lat: number; lng: number; accuracy?: number | null; heading?: number | null; battery?: number | null; updatedAt: number }
export interface SafetyTimer { id: string; note?: string | null; status: string; startedAt: number; dueAt: number; remainingSec: number }
/// 每日定时报到配置：startMinute=本地时区一天中的第几分钟（0..1439）；tz 为 IANA 时区。
export interface DailyCheckinSchedule { enabled: boolean; startMinute: number; durationMinutes: number; tz: string; note?: string }
export interface AppConfig {
  features: Record<string, boolean>
  registrationEnabled: boolean
  recording: { enabled: boolean; requireConsent: boolean }
  announcement?: { enabled: boolean; text?: string; level?: string } | null
  maintenance?: { enabled: boolean; message?: string } | null
  requireVerification?: boolean
  legalVersion?: string // 当前条款版本；与 me.legalConsentVersion 不一致则请用户重新同意
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
    case 'too_many_requests': return t('操作太频繁，请稍候再试', 'Too many attempts — please wait a moment')
    case 'content_blocked': return t('消息含被禁止的内容，未发送', "Message contains blocked content and wasn't sent")
    case 'message_too_long': return t('消息太长，请缩短后再发', 'Message is too long — please shorten it')
    case 'blocked': return t('你们之间存在拉黑，无法发送', "Can't send — one of you blocked the other")
    case 'not_linked': return t('对方已不是你的联系人，无法发送', 'This person is no longer your contact')
    case 'not_member': return t('你已不在该群聊中', "You're no longer in this group")
    // 撤回/编辑的时限与可编辑性：给**确定**文案（此前各调用点靠带"？"的兜底猜"超过N分钟？"，
    // 且撤回失败恒显时限、掩盖了功能关停/维护等真因——见 recall 改用本映射）。
    case 'recall_window_passed': return t('消息发出已超过 2 分钟，无法撤回', 'Messages can only be recalled within 2 minutes of sending')
    case 'edit_window_passed': return t('消息发出已超过 15 分钟，无法编辑', 'Messages can only be edited within 15 minutes of sending')
    case 'not_editable': return t('这条消息不可编辑（仅文字消息可编辑）', "This message can't be edited (text messages only)")
    case 'media_too_large': return t('视频太大（上限 50MB），请选短一点的', 'Video too large (50MB max) — pick a shorter one')
    case 'media_quota_exceeded': return t('你的媒体存储空间已满，请删除一些旧的视频消息', 'Your media storage is full — delete some old video messages')
    case 'unsupported_media_type': return t('不支持的文件格式', 'Unsupported file type')
    default: return fallback ?? t('发送失败', 'Failed to send')
  }
}

/// 呼叫/求助路径错误码→用户文案（与 iOS AssistStrings.callErrorText 对齐）。
/// /api/assist/call 受 requireFeature('calls')、/api/assist/help/claim 受 requireFeature('helpRequests') 门控，
/// 关停/维护时会返回 feature_disabled/maintenance——这是"重试也没用"的状态，不加区分只报"呼叫失败"会让协助者
/// 对着被关停的功能反复重试。fallback 为未知码时各调用点的兜底（"呼叫失败"/"认领失败"）。
export function callErrorText(err: unknown, t: (zh: string, en: string) => string, fallback: string): string {
  const code = err instanceof APIError ? err.code : ''
  switch (code) {
    case 'feature_disabled': return t('通话功能已被管理员暂时关闭', 'Calling is currently turned off by the administrator')
    case 'maintenance': return t('系统维护中，请稍后再试', 'Under maintenance — please try again later')
    case 'too_many_requests': return t('操作太频繁，请稍候再试', 'Too many attempts — please wait a moment')
    case 'not_linked': return t('你们尚未建立联系', 'You are not linked')
    case 'already_claimed_or_gone': return t('该求助已被认领或已结束', 'Already claimed or gone')
    default: return fallback
  }
}

/// content_blocked（昵称/用户名/联系人关系/群名等输入命中服务端内容过滤）→ 统一"该内容不被允许"文案；
/// 否则返回各调用点 fallback。避免把"内容被禁"压成笼统"保存/发送失败"让用户不知为何被拒、反复重试同一违规内容。
export function contentBlockedText(err: unknown, t: (zh: string, en: string) => string, fallback: string): string {
  if (err instanceof APIError && err.code === 'content_blocked') return t('该内容不被允许，请换一个', "That's not allowed — please choose another")
  return fallback
}

/// 登录请求体：标识（用户名/手机号/邮箱）**一律作为 username 字段**发送——服务端 loginSchema 只认
/// username(必填) 且用 findByLoginIdentifier 依次按 用户名→手机号(normalizePhone)→邮箱 解析这一个字段。
/// 此前误按类型拆成 email/phone 字段发送，导致邮箱/手机号登录因缺 username 被 400 挡下（仅用户名能登）。
export function buildLoginBody(identifier: string, password: string, totpCode?: string): Record<string, string> {
  const body: Record<string, string> = { username: identifier, password }
  if (totpCode) body.totpCode = totpCode
  return body
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

// 带 30s 超时的 fetch：网络挂死(连接被丢却无 RST)时 fetch 可能久久不返回——会让初始 /api/me 卡住、
// 整个应用无限转圈，或 401 续期挂住、请求永不完成。AbortController 兜底。仅用于 JSON 请求
// (rawFetch/tryRefresh)；媒体上下传走独立 fetch、不设此短超时（大文件慢传不应被误中止）。
async function timedFetch(input: string, opts: RequestInit, ms = 30_000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(input, { ...opts, signal: ctrl.signal }) }
  finally { clearTimeout(timer) }
}

async function rawFetch(method: string, path: string, body: unknown, auth: boolean, retry = true): Promise<unknown> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (auth && tokenStore.token) headers['authorization'] = 'Bearer ' + tokenStore.token
  let res: Response
  try {
    res = await timedFetch(apiURL(path), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  } catch { throw new APIError('network', 0) } // abort/网络失败统一按 network 错误
  if (res.status === 401 && auth) {
    // 尝试用 refresh 续期一次并重放（retry=false 防死循环）。
    if (retry && await tryRefresh()) return rawFetch(method, path, body, auth, false)
    // 续期失败，或续期后重放仍 401（会话已被撤销/封禁/改密——远程登出安全特性即时生效）：
    // 立即登出，不留"看似登录却样样 401"的中间态（否则要等下一个请求才自愈）。
    tokenStore.clear(); onUnauthorized?.()
    throw new APIError('unauthorized', 401)
  }
  let data: unknown = null
  try { data = await res.json() } catch { /* 204 等空体 */ }
  if (!res.ok) {
    const bodyCode = (data && typeof data === 'object' && 'error' in data) ? String((data as { error: unknown }).error) : ''
    // 429 归一：全局限流返回 fastify 文案串、assist 端点返回 'too_many_requests'、空体→http_429——统一成
    // 'too_many_requests'，让错误映射给出"稍候再试"而非笼统"请重试"（立刻重试只会再次撞限流）。
    // 例外：route_limit 是**语义上限**（对方路线数已满），非限流，须原样上抛供专属文案（否则被误报"太频繁"）。
    if (res.status === 429) throw new APIError(bodyCode === 'route_limit' ? 'route_limit' : 'too_many_requests', 429)
    const code = bodyCode || `http_${res.status}`
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
      const r = await timedFetch(apiURL('/api/auth/refresh'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) })
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
const del = (p: string, b?: unknown) => rawFetch('DELETE', p, b, true) // 可带 body（如按 endpoint 退订 web push）
const put = (p: string, b?: unknown) => rawFetch('PUT', p, b, true)

// ---------- API ----------
export const api = {
  // 登出：服务端吊销该 refresh token（不再能续期）。无需鉴权、不走 401 续期重试（auth=false）。
  // 与 iOS 登出对齐——否则 web 仅清本地存储，refresh token 在服务端 30 天 TTL 内仍有效（被窃取也无法靠登出失效）。
  logout: (refreshToken: string) => rawFetch('POST', '/api/auth/logout', { refreshToken }, false),
  // 认证
  async login(identifier: string, password: string, totpCode?: string): Promise<{ token: string; refreshToken: string; user: User }> {
    // 标识（用户名/手机号/邮箱）一律作为 username 传，服务端单字段解析（见 buildLoginBody）。
    return rawFetch('POST', '/api/auth/login', buildLoginBody(identifier, password, totpCode), false) as Promise<{ token: string; refreshToken: string; user: User }>
  },
  async register(username: string, password: string, role: string): Promise<{ token: string; refreshToken: string; user: User; created?: boolean }> {
    return rawFetch('POST', '/api/auth/register', { username, password, role }, false) as Promise<{ token: string; refreshToken: string; user: User; created?: boolean }>
  },
  // 找回密码（未登录）：① 按标识发验证码到已验证邮箱（服务端反枚举，恒返回 ok）② 凭码设新密码。与 iOS 同链、同服务端端点。
  forgotPassword: (username: string) => rawFetch('POST', '/api/auth/forgot-password', { username }, false) as Promise<{ ok: boolean }>,
  resetPassword: (username: string, code: string, newPassword: string) =>
    rawFetch('POST', '/api/auth/reset-password', { username, code, newPassword }, false) as Promise<{ ok: boolean }>,
  me: async () => ((await get('/api/me')) as { user: SelfView }).user,
  appConfig: () => get('/api/app-config') as Promise<AppConfig>,
  setRole: (role: string) => post('/api/account/role', { role }),
  setProfile: (displayName: string) => post('/api/account/profile', { displayName }),
  setAvatar: (avatar: string) => post('/api/account/avatar', { avatar }), // avatar=data:image/...;base64,（前端已 reencode 剥 EXIF+压到 ≤600KB）
  setLanguage: (language: string) => post('/api/account/language', { language }),
  // 记录用户同意的条款版本（GDPR 可证明同意）：与 app-config.legalVersion 一致后不再提示重新同意。
  legalConsent: (version: string) => post('/api/account/legal-consent', { version }) as Promise<{ ok: boolean; legalConsentVersion: string; legalConsentAt: number }>,
  // 读回执开关（WhatsApp 语义，仅单聊）：关了→不发也不看（互惠）。未读计数不受影响。
  setReadReceipts: (enabled: boolean) => post('/api/account/read-receipts', { enabled }) as Promise<{ ok: boolean; readReceiptsEnabled: boolean }>,
  setPassword: (oldPassword: string, newPassword: string) => post('/api/account/password', { oldPassword, newPassword }),
  setPhone: (phone: string) => post('/api/account/phone', { phone }),
  setUsername: (username: string) => post('/api/account/username', { username }),
  setEmail: (email: string) => post('/api/account/email', { email }),       // 设置/换绑邮箱 → 服务端发验证码
  verifyEmail: (code: string) => post('/api/account/email/verify', { code }), // 校验验证码 → 标记已验证
  // 删号须重新验证身份（服务端要求，不可逆+级联清空）：带当前密码。Apple 账号在 iOS 走 Apple 重验，web 端用密码。
  deleteAccount: (password: string) => del('/api/account', { password }),

  // 登录设备 / 会话管理
  sessions: () => get('/api/account/sessions') as Promise<{ sessions: SessionInfo[] }>,
  revokeSession: (sessionId: string) => post('/api/account/sessions/revoke', { sessionId }),
  revokeOtherSessions: (keepEndpoint?: string) => post('/api/account/sessions/revoke-others', keepEndpoint ? { keepEndpoint } : undefined),

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
  setLinkEmergency: (id: string, isEmergency: boolean) => post(`/api/family/links/${id}/emergency`, { isEmergency }) as Promise<{ link: FamilyLink }>,
  deleteLink: (id: string) => del(`/api/family/links/${id}`),
  lookupUser: (q: string) => get(`/api/users/lookup?q=${encodeURIComponent(q)}`) as Promise<{ user?: User }>,

  // 拉黑（后端返回 { id, user: publicUser }，与 iOS 一致）
  blocks: () => get('/api/blocks') as Promise<{ blocks: { id: string; user: { id: string; displayName: string; avatar?: string | null } }[] }>,
  block: (userId: string) => post('/api/blocks', { userId }),
  unblock: (id: string) => del(`/api/blocks/${id}`),

  // 通话 / 求助
  callHistory: () => get('/api/calls') as Promise<{ calls: CallRecordInfo[] }>,
  iceServers: () => get('/api/assist/turn') as Promise<{ iceServers: IceServer[] }>,
  // 通话连接失败上报（best-effort，把 ICE relay 不可达等静默故障变成服务端可观测计数）。reason 白名单。
  reportCallFailure: (reason: 'relay_unreachable' | 'generic' | 'signaling', callId?: string) =>
    post('/api/assist/call-failure', { reason, ...(callId ? { callId } : {}) }) as Promise<{ ok: boolean }>,
  incomingCalls: () => get('/api/assist/incoming') as Promise<{ calls: IncomingCall[] }>,
  registerCall: (callId: string, targetUserIds: string[]) => post('/api/assist/call', { callId, targetUserIds }),
  cancelCall: (callId: string) => post('/api/assist/call/cancel', { callId }),
  declineCall: (callId: string) => post('/api/assist/call/decline', { callId }),
  answeredCall: (callId: string) => post('/api/assist/call/answered', { callId }) as Promise<{ ok: boolean; answeredBy: string | null; youWon: boolean; gone?: boolean }>,
  callStatus: (callId: string) => get(`/api/assist/call/status?callId=${encodeURIComponent(callId)}`) as Promise<{ exists?: boolean; declinedAll?: boolean }>,
  onlineCount: () => get('/api/assist/online-count') as Promise<{ total: number; online: number }>,
  heartbeat: (available = true) => post('/api/assist/heartbeat', { available }),
  // 协助者行为守则确认（一次性守则卡）：服务端留痕，selfView.helperGuidelineAckAt 回传。
  guidelineAck: () => post('/api/assist/guideline-ack', {}) as Promise<{ ok: boolean; helperGuidelineAckAt: number }>,
  // 路线库（亲友远程路线编排）：替互链盲人画常走路线 / 自存路线；服务端校验互链与上限。
  listRoutes: () => get('/api/routes') as Promise<{ routes: SavedRouteInfo[] }>,
  createRoute: (name: string, waypoints: RouteWaypoint[], forUserId?: string) =>
    post('/api/routes', { name, waypoints, ...(forUserId ? { forUserId } : {}) }) as Promise<{ route: SavedRouteInfo }>,
  updateRoute: (id: string, patch: { name?: string; waypoints?: RouteWaypoint[] }) =>
    put(`/api/routes/${encodeURIComponent(id)}`, patch) as Promise<{ route: SavedRouteInfo }>,
  deleteRoute: (id: string) => del(`/api/routes/${encodeURIComponent(id)}`),
  helpQueue: () => get('/api/assist/help/queue') as Promise<{ requests: HelpRequest[]; count: number }>,
  claimHelp: (callId: string) => post('/api/assist/help/claim', { callId }) as Promise<{ request: { callId: string; fromName: string; fromAvatar?: string | null; language?: string | null; locality?: string | null; topic?: string | null } }>,
  // 随机/偏好匹配一条等待中的公开求助并**原子认领**（对齐 iOS 协助端「帮我匹配」）：一键接入等最久的求助者，
  // 无需手动扫队列。无可匹配则 request 为 null（非错误）。返回的 request 已被本人认领，直接 claimQueue 入会即可
  // （claimHelp 对同一认领者幂等，见服务端 openHelp.claim）。
  helpMatch: (opts?: { preferredLanguage?: string; requireLanguageMatch?: boolean }) =>
    post('/api/assist/help/match', opts ?? {}) as Promise<{ request: { callId: string; fromName: string; fromAvatar?: string | null; language?: string | null; locality?: string | null; topic?: string | null } | null }>,

  // 实时位置共享（与亲友/协助者互相可见；纯内存、按已接受绑定授权）
  updateLocation: (body: { lat: number; lng: number; accuracy?: number; heading?: number; battery?: number; ttlSec?: number }) =>
    post('/api/locations/update', body) as Promise<{ ok: boolean; sharingUntil: number }>,
  stopSharingLocation: () => post('/api/locations/stop'),
  contactLocations: () => get('/api/locations/contacts') as Promise<{ sharing: boolean; sharingUntil: number; contacts: ContactLocation[] }>,
  // 请求对方共享位置（nudge，对方自行决定）：alreadySharing=对方已在共享；deduped=5 分钟内已请求过。
  requestLocation: (userId: string) => post('/api/locations/request', { userId }) as Promise<{ ok: boolean; alreadySharing?: boolean; deduped?: boolean }>,

  // 录制（知情同意握手 + 创建元数据；策略经 app-config 下发）
  recordingConsent: (callId: string, granted: boolean) => post('/api/recordings/consent', { callId, granted }),
  createRecording: (body: { callId: string; reason?: string; mediaId?: string; durationSec?: number; lat?: number; lon?: number; locationLabel?: string }) =>
    post('/api/recordings', body) as Promise<{ recording: { id: string } }>,

  // 聊天
  conversations: () => get('/api/conversations') as Promise<{ conversations: Conversation[] }>,
  muteConversation: (peerId: string, muted: boolean) => post(`/api/conversations/${encodeURIComponent(peerId)}/mute`, { muted }) as Promise<{ muted: boolean }>,
  // before+beforeId 组成 (createdAt,id) 复合游标，翻页边界遇同毫秒消息不漏。
  messagesWith: (peerId: string, before?: number, beforeId?: string) => get(`/api/messages?with=${encodeURIComponent(peerId)}${before ? `&before=${before}` : ''}${beforeId ? `&beforeId=${encodeURIComponent(beforeId)}` : ''}`) as Promise<{ messages: ChatMessage[] }>,
  groupMessages: (groupId: string, before?: number, beforeId?: string) => get(`/api/messages?group=${encodeURIComponent(groupId)}${before ? `&before=${before}` : ''}${beforeId ? `&beforeId=${encodeURIComponent(beforeId)}` : ''}`) as Promise<{ messages: ChatMessage[] }>,
  sendMessage: (target: { toId?: string; groupId?: string }, kind: string, text: string, replyTo?: string, forwarded?: boolean) => post('/api/messages', { ...target, kind, text, ...(replyTo ? { replyTo } : {}), ...(forwarded ? { forwarded: true } : {}) }) as Promise<{ message: ChatMessage }>,
  // 会话内搜索文本消息（时间倒序）：peerId 或 groupId 二选一。
  searchMessages: (scope: { peerId?: string; groupId?: string }, query: string) => {
    const s = scope.groupId ? `group=${encodeURIComponent(scope.groupId)}` : `with=${encodeURIComponent(scope.peerId ?? '')}`
    return get(`/api/messages/search?${s}&q=${encodeURIComponent(query)}`) as Promise<{ messages: ChatMessage[] }>
  },
  // 跨会话全局搜索（WhatsApp 式"那个地址在哪个对话里"）：本人参与的全部单聊+所在群，时间倒序。
  searchAllMessages: (query: string, limit = 20) => get(`/api/messages/search?q=${encodeURIComponent(query)}&limit=${limit}`) as Promise<{ messages: ChatMessage[] }>,
  markRead: (fromId: string) => post('/api/messages/read', { fromId }),
  markGroupRead: (groupId: string) => post('/api/messages/read', { groupId }),
  recallMessage: (id: string) => post(`/api/messages/${id}/recall`) as Promise<{ message: ChatMessage }>,
  editMessage: (id: string, text: string) => post(`/api/messages/${id}/edit`, { text }) as Promise<{ message: ChatMessage }>,
  reactMessage: (id: string, emoji: string) => post(`/api/messages/${id}/reaction`, { emoji }) as Promise<{ message: ChatMessage }>,
  groups: () => get('/api/groups') as Promise<{ groups: GroupSummary[] }>,
  muteGroup: (groupId: string, muted: boolean) => post(`/api/groups/${encodeURIComponent(groupId)}/mute`, { muted }) as Promise<{ muted: boolean }>,
  createGroup: (name: string, memberIds: string[]) => post('/api/groups', { name, memberIds }),
  // 后端期望单个 { userId }（非 memberIds 数组）——此前形状不匹配会 400。逐个加。
  addGroupMember: (id: string, userId: string) => post(`/api/groups/${id}/members`, { userId }),
  leaveGroup: (id: string, userId: string) => del(`/api/groups/${id}/members/${userId}`),
  // 群改名（群主）：其余成员会收到 group_renamed 通知。
  renameGroup: (id: string, name: string) => post(`/api/groups/${id}/rename`, { name }) as Promise<{ group: GroupSummary['group'] }>,
  deleteGroup: (id: string) => del(`/api/groups/${id}`),

  // 录制
  myRecordings: () => get('/api/recordings/mine') as Promise<{ recordings: RecordingInfo[] }>,
  deleteMyRecording: (id: string) => del(`/api/recordings/mine/${id}`),
  recordingPlayToken: (id: string) => get(`/api/recordings/${id}/play-token`) as Promise<{ token: string; expiresInSec: number }>,

  // 通知
  notifications: () => get('/api/notifications') as Promise<{ notifications: NotificationInfo[]; unread: number }>,
  // 未读汇总（单聊+群聊+铃铛通知），供标签标题/导航徽标一次轻量拉取。
  unreadSummary: () => get('/api/unread') as Promise<{ messages: number; notifications: number; missedCalls: number; total: number }>,
  markNotifRead: (id: string) => post(`/api/notifications/${id}/read`),
  markAllNotifsRead: () => post('/api/notifications/read-all'),
  deleteNotif: (id: string) => del(`/api/notifications/${encodeURIComponent(id)}`),
  clearReadNotifs: () => post('/api/notifications/clear-read') as Promise<{ cleared: number }>,
  // 勿扰时段：软通知在此时段只抑制推送横幅、站内通知照常；紧急/来电不受影响。
  quietHours: () => get('/api/notifications/quiet-hours') as Promise<{ quietHours: QuietHoursInfo | null }>,
  setQuietHours: (q: QuietHoursInfo) => put('/api/notifications/quiet-hours', q) as Promise<{ quietHours: QuietHoursInfo }>,
  // 按类别静音推送横幅（与勿扰时段正交）：muted 为已静音类别；available 为可选类别。危急类不可静音。
  pushCategories: () => get('/api/notifications/push-categories') as Promise<{ muted: PushCategory[]; available: PushCategory[] }>,
  setPushCategories: (muted: PushCategory[]) => put('/api/notifications/push-categories', { muted }) as Promise<{ muted: PushCategory[] }>,
  // 紧急医疗信息：本人查看/填写自己的；作为紧急亲友查看某遇险者的（施救辅助）。
  medicalInfo: () => get('/api/account/medical') as Promise<{ medicalInfo: string; updatedAt: number | null }>,
  setMedicalInfo: (text: string) => put('/api/account/medical', { text }) as Promise<{ ok: boolean; cleared?: boolean }>,
  contactMedicalInfo: (userId: string) => get(`/api/family/${userId}/medical`) as Promise<{ medicalInfo: string; fromName?: string; updatedAt: number | null }>,
  // 安全报到（dead-man's switch）：设时限，到点未报平安则服务端自动告警紧急联系人+发实时位置。与 iOS 同端点。
  safetyCheckin: () => get('/api/safety/checkin') as Promise<{ timer: SafetyTimer | null; hasEmergencyContact: boolean }>,
  startSafetyCheckin: (durationMinutes: number, note?: string) =>
    post('/api/safety/checkin/start', { durationMinutes, ...(note ? { note } : {}) }) as Promise<{ timer: SafetyTimer; hasEmergencyContact: boolean }>,
  completeSafetyCheckin: () => post('/api/safety/checkin/complete', undefined) as Promise<{ ok: boolean; completed: boolean }>,
  extendSafetyCheckin: (addMinutes: number) => post('/api/safety/checkin/extend', { addMinutes }) as Promise<{ timer: SafetyTimer }>,
  // 每日定时报到（Snug Safety 式）：每天固定本地时刻自动开启一次报到，超时未报平安自动告警紧急联系人。
  checkinSchedule: () => get('/api/safety/checkin/schedule') as Promise<{ schedule: DailyCheckinSchedule | null }>,
  setCheckinSchedule: (s: DailyCheckinSchedule) => put('/api/safety/checkin/schedule', s) as Promise<{ ok: boolean; schedule: DailyCheckinSchedule; hasEmergencyContact: boolean }>,
  cancelSafetyCheckin: () => post('/api/safety/checkin/cancel', undefined),
  // 紧急告警"知道了"回执：回告发起人"有人已看到你的求助"（fromId=发起人，eventId=哪一次告警）。
  // onMyWay=true：不只"我已看到"，而是"我正在赶来"——遇险者据此知救援真在路上、可安心等待。缺省=普通回执。
  emergencyAck: (fromId: string, eventId?: string, onMyWay?: boolean) => post('/api/emergency/ack', { fromId, eventId, onMyWay }),
  // Web Push（浏览器推送紧急告警）
  webVapidKey: () => get('/api/push/web-vapid-key') as Promise<{ key: string }>,
  webPushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) => post('/api/push/web-subscribe', sub),
  webPushUnsubscribe: (endpoint: string) => del('/api/push/web-subscribe', { endpoint }),
  webPushTest: () => post('/api/push/web-test') as Promise<{ ok: boolean; sent: number; total: number }>,

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
export interface AdminUser { id: string; username: string; displayName: string; role: string; status: string; avatar?: string | null; createdAt: number; online?: boolean; hasEmail?: boolean; hasPhone?: boolean; emailVerified?: boolean; appleLinked?: boolean; verified?: boolean }
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

// 录制回放：同样用 Bearer 拉 blob 后 objectURL，而非 `<video src=...?t=令牌>` 流式。
// 那个 ?t= 媒体令牌仅 60s——而 <video> 的每个 Range 请求都带它，故 >60s 的回放或拖动会 401 致播放中断；
// 改走 1h access token 一次性下载(媒体≤50MB)，blob 本地播放后拖动/重播都不再请求服务端，且 URL 里不再带令牌
// (无 URL 令牌泄漏面)。与 iOS「下载到本地再播」一致。错误状态码透传，供调用方区分 403/404。
/// 拉取本人录音媒体（Bearer 鉴权）为 Blob：播放（objectURL）与下载（存盘，数据可携权）共用同一取媒体路径。
export async function fetchRecordingBlob(id: string): Promise<Blob> {
  const res = await fetch(apiURL(`/api/recordings/${id}/media`), { headers: tokenStore.token ? { authorization: 'Bearer ' + tokenStore.token } : {} })
  if (!res.ok) throw new APIError('media_failed', res.status)
  return await res.blob()
}
export async function fetchRecordingObjectURL(id: string): Promise<string> {
  return URL.createObjectURL(await fetchRecordingBlob(id))
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

// Blob → data URL（base64）。头像端点收 data URL 的 JSON（区别于证件图的二进制上传）。
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new APIError('image_read_failed', 0))
    r.readAsDataURL(blob)
  })
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
