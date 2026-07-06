import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalizePhone } from '../auth/apple' // 纯字符串工具，无模块级副作用、不依赖 store（无循环）
import type { Sealed } from '../kyc/crypto' // 仅类型导入（编译期擦除）——不触发 crypto 的 KYC_ENC_KEY 启动校验

/// 角色（见 PLAN §14.2）。admin/developer 不可自助注册，由后台分配。
export type Role = 'blind' | 'helper' | 'family' | 'admin' | 'developer'
export type UserStatus = 'active' | 'disabled'

export interface User {
  id: string
  username: string
  passwordHash: string
  displayName: string
  role: Role
  status: UserStatus
  createdAt: number
  language?: string // 协助者/亲友所说语言(如 'zh'/'en')，用于匹配排序加分（见审查 #10）
  tokenVersion?: number // 递增即令该用户已签发的 access token 全部失效（改密/封禁，见审查 #1/#2）
  email?: string // 可选邮箱：用于邮箱验证 + 找回密码（D1）。仅本人 /api/me 可见，不进 publicUser。
  emailVerified?: boolean // 邮箱是否已通过验证码确认
  voipToken?: string // PushKit VoIP 推送 token（A1 后台来电）。仅服务端用于发推，不对外暴露。
  avatar?: string // 头像：小尺寸图片 data URL(base64)。非敏感，进 publicUser 供联系人/队列/通话显示。
  apnsToken?: string // 普通 APNs 提醒推送 token（软件外通知，区别于 voipToken）。
  phone?: string // 可选手机号（归一化数字串）：可作为登录标识（手机号+密码）。仅本人可见，不进 publicUser。
  appleSub?: string // Sign in with Apple 的稳定用户标识（identityToken.sub）。仅服务端用于匹配账号。
  usernameCustomized?: boolean // 用户是否设置过自定义用户名（自动生成的 user_/apple_ 为 false）。为 false 时客户端提示设置唯一 userid。
  legalConsentVersion?: string // 用户同意的隐私政策/使用条款版本（如 "2.0"）。注册须同意方可完成（GDPR 可证明同意）。
  legalConsentAt?: number // 同意时间戳（ms）。
  helperGuidelineAckAt?: number // 协助者行为守则（只描述、不替对方做安全决策）首次确认时间戳（ms）。客户端据此一次性展示守则卡；服务端留痕供追责。
  // 单用户功能覆盖（管理员可对**某个用户**单独关停某功能，用于精准处置滥用者，不波及全站）。
  // 仅能"强制关"：某键为 false 即对该用户关闭；缺省/为 true 则随全站开关。见 effectiveFeatures。
  featureOverrides?: Partial<Record<FeatureKey, boolean>>
  // 两步验证（2FA / TOTP）。totpSecret 为 base32 密钥（仅服务端校验用，绝不进任何对外视图）；
  // totpEnabled=true 才在登录时强制验证码（setup 后、enable 前 secret 已写但 enabled 仍假=待启用）。
  totpSecret?: string
  totpEnabled?: boolean
  totpLastCounter?: number // 上次已接受的 TOTP 时间步计数：拒绝 <= 此值的码，使每个 TOTP 单次有效（防 ±窗口内重放）
  // 实名认证（KYC，管理员人工审核通过）。仅此布尔进对外视图——真实姓名/证件绝不经此外泄，
  // 明文姓名仅在 admin 审核详情端点解密一次（审计留痕），证件图片落隔离加密目录、审核后按留存策略清除。
  identityVerified?: boolean
  // 勿扰时段（Do-Not-Disturb）：在此时段内**抑制软通知的推送横幅**（好友请求/聊天/到家提醒等），
  // 但站内通知照常持久化（醒来可回看）。**紧急告警/来电/SOS 走独立扇出、绝不受此影响**（见 quietHours.ts）。
  quietHours?: QuietHours
  // 按类别静音的推送横幅（'social'|'route'|'location'）：与勿扰时段正交——**时段**是何时静，**类别**是哪类静。
  // 仅抑制该类**推送横幅**，站内通知照常持久化（可回看）。紧急/安全/来电/报到经 notifCategory→null 天然豁免、永不可被静音。
  mutedPushCategories?: string[]
  // 上次查看通话记录的时刻（ms）：晚于此的未接来电计入"未看未接来电"角标；打开通话记录即刷新此值清角标。
  callHistorySeenAt?: number
}

/// 勿扰时段配置（服务端据收件人本地时刻判定，正确处理跨午夜与时区/DST）。
export interface QuietHours {
  enabled: boolean
  startMinute: number  // 本地分钟-of-day [0,1439]（如 22:00 = 1320）
  endMinute: number    // 本地分钟-of-day [0,1439]（如 07:00 = 420）；start>end 表示跨午夜
  tz: string           // IANA 时区（如 "Asia/Shanghai"）——服务端据此算收件人本地时刻
}

/// 一次性恢复码（2FA）：丢失验证器时用。库里只存 SHA-256 哈希，明文仅生成时给用户一次。
export interface RecoveryCode {
  id: string
  userId: string
  codeHash: string
  usedAt?: number // 已用时间戳；用过即作废（一次性）
}

/// Passkey（WebAuthn 凭据）：一个用户可注册多把。只存公钥与计数器，私钥永不离开设备安全区。
export interface Passkey {
  id: string            // 我们的主键（随机）
  userId: string
  credentialId: string  // base64url 凭据 ID（WebAuthn credential.id，全局唯一）
  publicKey: string     // base64url 存储的 COSE 公钥
  counter: number       // 签名计数器（防克隆重放）
  deviceName?: string   // 展示名（如 "iPhone"）
  createdAt: number
}

/// 亲友绑定：视障用户(owner) ↔ 亲友/协助者账号(member)，可标记为紧急联系人。
export type LinkStatus = 'pending' | 'accepted'

export interface FamilyLink {
  id: string
  ownerId: string
  memberId: string
  relation: string
  isEmergency: boolean
  phone?: string // 亲友真实手机号（App 通话连不上时一键拨打兜底）
  createdAt: number
  // 被绑定方(member)的同意状态：新绑定为 pending，member 接受后才 accepted。
  // 仅 accepted 的绑定参与匹配/呼叫/紧急路由——否则任意用户可单向绑定他人来探测在线状态/强推来电（见审查 #6）。
  // 旧库无此列读为 undefined，按 accepted 兼容（不破坏既有绑定）。
  status?: LinkStatus
  // 发起请求的一方（双向加好友：盲人或亲友/协助者任一方都可发起，由**另一方**确认才 accepted）。
  // owner 恒为视障侧（保证匹配/紧急用 linksByOwner(blind) 仍成立）；requestedBy 仅记录是谁发的请求。
  requestedBy?: string
}

/// 黑名单：blocker 拉黑 blocked 后，双方互不出现在对方的匹配/求助队列/来电中。
export interface Block {
  id: string
  blockerId: string
  blockedId: string
  createdAt: number
}

/// 通话记录：每个 (callId, callee) 一条。caller 视角为"呼出"，callee 视角为"呼入/未接"。
export type CallRecordStatus = 'missed' | 'answered' | 'declined'
export interface CallRecord {
  id: string
  callId: string
  callerId: string
  calleeId: string
  status: CallRecordStatus
  createdAt: number
  emergency?: boolean // 紧急求助呼叫（盲人一键 SOS）——供通话记录突出"未接紧急求助"，提示优先回拨
}

/// 举报（通话后一键举报 → 管理员审核）。
export type ReportStatus = 'open' | 'resolved'
export type ReportDecision = 'dismissed' | 'warned' | 'suspended' | 'banned'
export interface Report {
  id: string
  reporterId: string
  targetUserId: string
  callId?: string
  reason: string
  status: ReportStatus
  createdAt: number
  decision?: ReportDecision // 审核处置结果（resolved 时记录）
  resolvedBy?: string       // 处置管理员 id
  resolvedAt?: number
  evidenceRecordingId?: string // 举报证据：关联的通话录制（举报人须为该录制的参与者方可附上）
}

/// 站内通知（持久化收件箱）：可靠投递事件结果（如"举报已处置"），不依赖易丢的推送。
/// 推送（APNs sendAlert）仅作为离线提醒；权威与可回看的来源是这张表。
/// 紧急事件日志（治理/值守）：每次摔倒/车祸/手动 SOS 告警落一条——管理员据此值守与事后追溯
/// （"告警发出去了吗/通知到几个人/位置是实时还是兜底"）。与站内通知（发给亲友的收件箱）互补：
/// 通知是给亲友的、随人删除；本日志是运营记录、按保留期清扫。坐标为敏感 PII，仅 admin 可见。
export interface EmergencyEvent {
  id: string
  userId: string
  kind: string          // fall | crash | manual
  lat?: number
  lon?: number
  locSource?: string    // live | lastKnown | none（与告警响应口径一致，诚实标注）
  locAgeSec?: number    // lastKnown 时：定位距告警的秒数
  notified: number      // 实际推送到的亲友数（有 APNs token）
  contacts: number      // accepted 亲友总数
  at: number
  resolvedAt?: number   // 发起人报平安(all-clear)解除的时刻；未解除则 undefined。供 admin 区分"已解除/误报"与"可能仍在进行"
  ackedAt?: number      // 首个亲友"知道了"(ack)的时刻；有则不升级重呼（有人在响应）
  escalatedAt?: number  // 无人响应达阈值 → 升级重呼的时刻；只升级一次
}

/// Web Push 订阅（浏览器推送）：web-only 协助者关掉标签页也能收到紧急告警。
/// endpoint 全局唯一（浏览器推送服务签发）作主键；一个用户可有多个订阅（多浏览器/多设备）。
export interface WebPushSubscription {
  endpoint: string
  userId: string
  p256dh: string   // 浏览器公钥（加密负载用）
  auth: string     // 鉴权密钥
  createdAt: number
}

export interface Notification {
  id: string
  userId: string            // 收件人
  kind: string              // 'report_resolved' 等
  title: string
  body: string
  data?: Record<string, string> // 附带结构化数据（如 reportId/decision），供客户端跳转/展示
  createdAt: number
  readAt?: number           // 已读时间（未读=undefined）
}

/// 管理审计日志：每条后台**变更**操作留痕（可追责、可证明合规）。
export interface AdminAuditEntry {
  id: string
  adminId: string
  action: string      // 如 user.ban / user.role / report.moderate / config.update
  targetType: string  // user | report | config | recording | kyc
  targetId: string
  detail?: string     // 补充（如 reason、from→to）
  at: number
}

/// 用户警告（内容审核的轻处置：警告但不封号）。
export interface Warning {
  id: string
  userId: string
  reason: string
  byAdminId: string
  reportId?: string
  at: number
}

/// 可被管理员全站开关的功能键。每个键都**真正在对应路由强制**（关闭即 403 feature_disabled），
/// 并由 iOS 经 GET /api/app-config 读取后隐藏/禁用对应按钮——不是摆设。
/// 刻意排除的安全攸关功能：紧急报警、拉黑、举报——永不可一键关停（关停会危及用户或破坏审核闭环）。
/// 账号自管理（改密码/邮箱/手机/角色/用户名等）也不在此列——绝不把用户锁在自己账号外。
export type FeatureKey =
  | 'messaging'    // 私聊/群聊发消息（含撤回/表态/已读）
  | 'calls'        // 远程协助音视频呼叫
  | 'helpRequests' // 公开求助队列（发起/认领/匹配）
  | 'groups'       // 群组创建/成员管理
  | 'familyLinks'  // 亲友/协助者绑定
  | 'mediaUpload'  // 大文件（图片/视频）上传
  | 'navigation'   // 步行导航（高德路径）
  | 'sceneScan'    // 端侧"看一看"场景识别（仅客户端据此隐藏，无服务端调用可拦）
  | 'locationSharing' // 与亲友/协助者实时共享位置
  | 'aiDescribe'   // AI 云端场景描述/图像问答（需配 VISION_* env，未配则 503；服务端 /api/vision/describe 强制拦）

export const FEATURE_KEYS: FeatureKey[] = ['messaging', 'calls', 'helpRequests', 'groups', 'familyLinks', 'mediaUpload', 'navigation', 'sceneScan', 'locationSharing', 'aiDescribe']

/// 全站公告（管理员推送给所有 App 用户的横幅）。
export interface Announcement {
  active: boolean
  message: string
  level: 'info' | 'warning'
}
/// 维护模式：开启后服务端拒绝所有功能写操作（503），App 显示维护横幅；登录/账号自管理/后台不受影响。
export interface MaintenanceMode {
  active: boolean
  message: string
}
/// 内容过滤（主动审核，防违规违法）：管理员维护违禁词；命中则拒收（消息/群名/昵称）。默认空=不生效。
export interface ContentFilter {
  enabled: boolean
  terms: string[]
}

/// 全站运行配置（管理员可控的"开关")。
export interface AppConfig {
  registrationEnabled: boolean // 是否开放注册（关闭后新账号注册/邮箱码建号被拒）
  features: Record<FeatureKey, boolean> // 各功能开关；默认全开
  announcement: Announcement     // 全站公告横幅
  maintenance: MaintenanceMode   // 维护模式
  contentFilter: ContentFilter   // 内容违禁词过滤
  requireVerification: boolean   // 是否要求实名认证：开启后未通过 KYC 的可门控角色除"提交认证/紧急/账户基本"外一律 403（管理员可即时开关，作为安全攸关 App 的兜底开关）
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  registrationEnabled: true,
  features: { messaging: true, calls: true, helpRequests: true, groups: true, familyLinks: true, mediaUpload: true, navigation: true, sceneScan: true, locationSharing: true, aiDescribe: true },
  announcement: { active: false, message: '', level: 'info' },
  maintenance: { active: false, message: '' },
  contentFilter: { enabled: false, terms: [] },
  requireVerification: false, // 默认关：现网由管理员显式开启；测试默认不门控
}

/// 配置补丁：嵌套对象可只带部分键（逐键合并）。
export interface AppConfigPatch {
  registrationEnabled?: boolean
  features?: Partial<Record<FeatureKey, boolean>>
  announcement?: Partial<Announcement>
  maintenance?: Partial<MaintenanceMode>
  contentFilter?: Partial<ContentFilter>
  requireVerification?: boolean
}

/// 归一化：补齐缺失键，使历史旧配置（无 features/announcement 等）平滑升级（向后兼容，无需迁移脚本）。
export function normalizeAppConfig(raw: Partial<AppConfig> | undefined | null): AppConfig {
  const rawFeat = (raw?.features ?? {}) as Partial<Record<FeatureKey, boolean>>
  const features = { ...DEFAULT_APP_CONFIG.features }
  for (const k of FEATURE_KEYS) if (typeof rawFeat[k] === 'boolean') features[k] = rawFeat[k]!
  const a = (raw?.announcement ?? {}) as Partial<Announcement>
  const m = (raw?.maintenance ?? {}) as Partial<MaintenanceMode>
  const cf = (raw?.contentFilter ?? {}) as Partial<ContentFilter>
  return {
    registrationEnabled: raw?.registrationEnabled ?? true,
    features,
    announcement: {
      active: a.active ?? false,
      message: typeof a.message === 'string' ? a.message : '',
      level: a.level === 'warning' ? 'warning' : 'info',
    },
    maintenance: {
      active: m.active ?? false,
      message: typeof m.message === 'string' ? m.message : '',
    },
    contentFilter: {
      enabled: cf.enabled ?? false,
      terms: Array.isArray(cf.terms) ? cf.terms.filter((t: unknown): t is string => typeof t === 'string') : [],
    },
    requireVerification: raw?.requireVerification ?? false,
  }
}

/// 合并 AppConfig 补丁：嵌套对象逐键合并（而非整体替换），其余浅合并。
export function mergeAppConfig(base: AppConfig, patch: AppConfigPatch): AppConfig {
  return normalizeAppConfig({
    registrationEnabled: patch.registrationEnabled ?? base.registrationEnabled,
    features: { ...base.features, ...(patch.features ?? {}) },
    announcement: { ...base.announcement, ...(patch.announcement ?? {}) },
    maintenance: { ...base.maintenance, ...(patch.maintenance ?? {}) },
    contentFilter: { ...base.contentFilter, ...(patch.contentFilter ?? {}) },
    requireVerification: patch.requireVerification ?? base.requireVerification,
  })
}

/// 某用户的**有效功能开关** = 全站开关 AND 该用户未被单独强制关停。
/// 覆盖只能"force off"（override 某键为 false 即关）；不能反向打开全站已关的功能。
export function effectiveFeatures(cfg: AppConfig, overrides?: Partial<Record<FeatureKey, boolean>>): Record<FeatureKey, boolean> {
  const out = { ...cfg.features }
  if (overrides) for (const k of FEATURE_KEYS) if (overrides[k] === false) out[k] = false
  return out
}

/// 内容过滤检查：返回命中的违禁词（小写子串匹配，大小写不敏感），未命中返回 null。
/// 关闭或空词表时恒返回 null（默认零影响，仅管理员显式配置后才生效）。
export function matchBannedTerm(cfg: AppConfig, text: string): string | null {
  if (!cfg.contentFilter.enabled || cfg.contentFilter.terms.length === 0 || !text) return null
  const lower = text.toLowerCase()
  for (const term of cfg.contentFilter.terms) {
    const t = term.trim().toLowerCase()
    if (t && lower.includes(t)) return term
  }
  return null
}

/// refresh token（仅存哈希，轮换+撤销）。
export interface RefreshToken {
  tokenHash: string
  userId: string
  expiresAt: number
  sessionId?: string  // 会话 ID：跨 refresh 轮换保持不变，标识一台设备的登录会话（「登录设备」列表/按设备登出）
  deviceLabel?: string // 设备友好标签（如 "iPhone"/"Chrome · Mac"），展示用
  createdAt?: number   // 会话创建（首次登录）时间
  lastSeenAt?: number  // 最近一次活动（refresh）时间
  rotatedAt?: number   // 墓碑：该 token 已被轮换用过的时刻。再次出现=重放（被窃信号）→ 吊销整个会话族。
}

/// 一个登录会话（去 token 哈希后对外展示）。
export interface SessionInfo {
  sessionId: string
  deviceLabel?: string
  createdAt?: number
  lastSeenAt?: number
  expiresAt: number
}

/// 录制策略（Q6）：默认不录、需同意、到期自动删。
export interface RecordingConfig {
  enabled: boolean
  retentionDays: number
  requireConsent: boolean
}

/// 一条录制的元数据（媒体文件本身由客户端/录制器处理，这里只管元数据与留存）。
/// 亲友编排/自存的步行路线（路线库，Soundscape Guided Routes 式）。
/// 坐标全程 **WGS-84**（全栈约定）：存储层绝不做坐标系转换；web 编辑器必须用 OSM/Leaflet 瓦片
/// （amap JS 瓦片是 GCJ-02，会让存储坐标系统性偏移），iOS 执行走 startBacktrack 同款免纠偏路径。
export interface SavedRoute {
  id: string
  ownerId: string    // 归属者（执行路线的盲人）；删号级联删除其全部路线
  createdBy: string  // 绘制者（互链亲友或本人）；绘制者删号不影响路线（归属者的资产）
  name: string
  waypoints: { lat: number; lng: number; note?: string }[]  // WGS-84 顺序航点（≥2）
  createdAt: number
  updatedAt: number
}

/// 保存的地点（"家"/"公司"/自定义如"医院"）：盲人日常通勤"带我回家/去公司"免每次报地址。
/// 存地址串（导航时实时 geocode），另**在保存时**一次性 geocode 出 WGS-84 坐标缓存（lat/lng）——供到达围栏判定
/// （"到家了"提醒），不改导航路径。坐标可空（geocode 失败/未配 amap/境外无法地理编码时）。每归属者每 label 唯一。
export interface SavedPlace {
  ownerId: string   // 归属者（盲人本人）；删号级联删除其全部地点
  label: string     // "home" / "work" / 自定义标签；(ownerId,label) 复合主键
  address: string   // 地点名或地址（导航时 geocode）
  lat?: number      // WGS-84（保存时 geocode 缓存，供到达围栏；可空）
  lng?: number
  updatedAt: number
}

/// 安全报到计时器（personal-safety "safety timer" / dead-man's switch，对标 Life360/bSafe/Noonlight）：
/// 盲人独自出行前设一个到期时刻，**未在到期前确认平安（complete）则服务端自动向其亲友告警**（复用紧急链路）。
/// 这是**主动**安全网，区别于摔倒检测/SOS 那种**被动/事后**告警。归属者独有数据，删号级联清除。
export interface SafetyTimer {
  id: string
  ownerId: string
  note?: string        // 可选说明（"步行回家"）；到期告警时展示给亲友，帮助判断去哪找人
  startedAt: number
  dueAt: number        // 到期时刻：未在此前 complete/cancel（或 extend 推后）则自动告警
  // active=进行中；completed=本人已报平安；canceled=本人取消；fired=到期自动告警已发出；
  // expired=到期时服务端宕机、恢复后已超宽限期 → 不迟发告警（免陈旧误报风暴），仅记终态。
  status: 'active' | 'completed' | 'canceled' | 'fired' | 'expired'
  firedAt?: number
  completedAt?: number
  canceledAt?: number
  eventId?: string     // fired 时触发的紧急事件 id（供关联/审计/报平安解除）
  remindedAt?: number  // 到期前提醒本人的时刻（防遗忘误报）；只提醒一次；extend 时清零以对新到期重新提醒
}

/// 紧急医疗信息（Apple Medical ID / Life360 式）：本人填写的关键健康信息（血型/过敏/用药/病史/紧急备注），
/// 供**指定的紧急亲友**在其遇险时了解、辅助施救。GDPR Art.9 特殊类别健康数据——**加密落库**（复用 KYC 信封
/// 加密 AES-256-GCM，见 kyc/crypto）：存储层只当不透明密文（sealed=JSON.stringify(Sealed)），不碰明文。
/// 1:1 于用户；本人可改可清；删号级联清除。
export interface MedicalInfo {
  userId: string
  sealed: string     // JSON.stringify(Sealed)——加密的医疗信息信封；存储层不解密、不感知内容
  updatedAt: number
}

export interface Recording {
  id: string
  callId: string
  ownerId: string
  consentBy: string[]
  reason: string
  recordedAt: number
  mediaId?: string // 关联的媒体文件（/api/media）：录制实体；删录制时一并删媒体（见 sweepExpiredRecordings/DELETE）
  // 详细元数据（"时间地点人 + 时长"）：
  participants?: string[]  // 参与者 userId（owner + 同意被录的对端）——"人"
  durationSec?: number     // 通话时长（秒）
  lat?: number             // 录制方位置纬度（仅当定位已授权时采集）——"地"
  lon?: number             // 录制方位置经度
  locationLabel?: string   // 可读地名（反向地理编码，可选）
  // 软删除/合规留存：用户可对自己的录制软删除（对其隐藏），但管理员在留存期内仍可查看（取证/合规）。
  // 真正的物理清除仍由 sweepExpiredRecordings 在 recordedAt+retentionDays 时统一执行。
  deletedAt?: number       // 用户软删除时间戳（undefined=未删）
}

/// 实名认证（KYC）：真实姓名 + 政府证件 + 自拍 → 管理员人工审核 → 通过/拒绝。
/// 无第三方自动核验、无 mock 自动通过：审核完全由真人管理员完成。
/// 状态机：pending → verified | rejected；拒绝后可重新提交（新建一条 pending）。
/// 同一用户同一时刻只允许一条「活跃」记录（pending 或 verified）——应用层守卫 + sqlite 部分唯一索引双保险。
export type VerificationStatus = 'pending' | 'verified' | 'rejected'
export type KycDocKind = 'front' | 'back' | 'selfie'
export type KycIdType = 'national_id' | 'passport' | 'drivers_license' | 'residence_permit'

/// 一张证件图片的引用：密文落 KYC_DIR 磁盘（文件名=blobId），信封参数 sealed 存库。
export interface KycBlobRef {
  kind: KycDocKind
  blobId: string // 服务端 UUID = 磁盘文件名
  sealed: Sealed // AES-256-GCM 信封（kyc/crypto），不含 ct（密文在磁盘）
  mime: string // 'image/jpeg' | 'image/png'（归一化后）
}

export interface Verification {
  id: string
  userId: string
  status: VerificationStatus
  idType: KycIdType
  idLast4?: string // 明文，非 PII，仅用于客服核对/去重展示
  // —— 加密小字段（决策后按策略清空）——
  nameSealed?: Sealed // AES-256-GCM(法定姓名)；通过后保留（徽章法律依据），拒绝即清
  idNumberSealed?: Sealed // AES-256-GCM(完整证件号)；任何决策后立即清
  // —— 加密证件图片（密文落盘，引用存此）——
  blobs?: KycBlobRef[] // 正面(+反面) + 自拍；决策后清空（文件删除）
  // —— 提交来源（v1 恒为 self；列已就绪，v1.1 亲友协助提交为 additive 扩展）——
  submittedVia: 'self' | 'assisted'
  submittedById: string // v1 === userId
  consentToken?: string // v1.1 亲友协助提交的一次性同意令牌
  consentVersion?: string // 提交时已确认的 KYC 同意版本
  // —— 审核 ——
  legalHold?: boolean // 管理员法务保留：豁免留存清除（取证）
  submittedAt: number
  decidedBy?: string // 审核管理员 id（或 'system' 表示留存清扫自动拒）
  decidedAt?: number
  rejectReasonCode?: string // 枚举（blurry/glare/name_mismatch/... | timeout | revoked）
  rejectReasonNote?: string
  attempt: number // 第几次提交（1,2,3…），重新提交递增
}

/// 聊天消息（单聊=accepted 绑定互发；群聊=群成员互发）。
/// kind=audio/image 时 text 为 data URL；kind=video 时 text 为 mediaId（服务器磁盘文件）；
/// kind=recalled 为已撤回占位（text 清空）。
export interface ChatMessage {
  id: string
  fromId: string
  toId: string        // 单聊收件人；群消息为 ''（以 groupId 寻址）
  kind: 'text' | 'audio' | 'image' | 'video' | 'location' | 'recalled'
  text: string
  createdAt: number
  readAt?: number // 单聊：收件人已读时间（已读回执）。群聊不用此字段（见 groupReads）
  reaction?: string // 表情回应（WhatsApp 式，单个 emoji，最新覆盖；空=无）
  groupId?: string // 群消息所属群
  editedAt?: number // 编辑时刻（WhatsApp 式，仅文字消息、限窗口内）；有值 → 客户端标"已编辑"
  replyTo?: string // 回复的消息 id（WhatsApp 式引用回复）；须为同一会话内的消息，否则发送时丢弃
  forwarded?: boolean // 转发标记（WhatsApp 式「已转发」）；客户端据此标注，防误以为是对方原创
}

/// 消息稳定全序比较：先 createdAt，再 id。让同毫秒消息排序确定、与翻页复合游标口径一致。
export function byTimeThenId(x: ChatMessage, y: ChatMessage): number {
  return x.createdAt !== y.createdAt ? x.createdAt - y.createdAt : (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)
}
/// 复合游标判定：消息是否严格早于 (beforeMs, beforeId) 这个 (createdAt,id) 点。
/// beforeMs 缺省=不翻页（全取）；beforeId 缺省=退回严格 createdAt<beforeMs（向后兼容旧客户端）。
export function beforeCursor(m: ChatMessage, beforeMs?: number, beforeId?: string): boolean {
  if (beforeMs == null) return true
  if (m.createdAt < beforeMs) return true
  return beforeId != null && m.createdAt === beforeMs && m.id < beforeId
}

/// 聊天群组（WhatsApp 式）：群主创建/加人/踢人/解散；成员可退群发言。
export interface ChatGroup {
  id: string
  name: string
  ownerId: string
  memberIds: string[] // 含群主
  createdAt: number
}

/// 媒体文件元数据（视频消息等大文件，实体存服务器磁盘 media/ 目录）。
export interface MediaMeta {
  id: string
  ownerId: string
  mime: string
  size: number
  createdAt: number
}

/// 持久化接口——上层只依赖它；可换内存 / JSON 文件 / 未来 SQLite。
export interface Store {
  /// 可选：把数据库一致性快照备份到 destPath（SQLite 用 VACUUM INTO——在线、无锁表、产物紧凑）。
  /// 仅 SqliteStore 实现；内存/JSON 存储不提供（调用方据 undefined 判定并返回 backup_unavailable）。
  backupTo?(destPath: string): void
  createUser(user: User): void
  findByUsername(username: string): User | undefined
  findByPhone(phone: string): User | undefined       // 手机号登录（归一化后精确匹配）
  findByEmail(email: string): User | undefined       // 邮箱登录（大小写不敏感）
  findByAppleSub(appleSub: string): User | undefined // Sign in with Apple 账号匹配
  findById(id: string): User | undefined
  allUsers(): User[]
  userCount(): number // O(1) 计数：/metrics 每次 Prometheus 抓取只需总数，避免 allUsers() 全表 SELECT *+映射
  updateUser(id: string, patch: Partial<User>): User | undefined
  deleteUser(id: string): void
  /// 设备推送 token 独占：某账号注册 token 时，从所有其它账号清除同一 token——
  /// 否则同一设备换账号后，旧账号仍持该 token，发给旧账号的推送会送到现登录账号的设备（跨账号泄漏）。
  clearApnsTokenFromOthers(token: string, exceptUserId: string): void
  clearVoipTokenFromOthers(token: string, exceptUserId: string): void
  /// 回收失效的推送 token：APNs 对某 token 返回 410（Unregistered，设备已卸载/token 失效）时，
  /// 从其所属账号清除该 token（apns 或 voip 字段任一匹配即清），避免此后对死 token 反复空投、
  /// 以及 Apple 因高失效率对发送方限流。
  clearPushToken(token: string): void

  createLink(link: FamilyLink): void
  linksByOwner(ownerId: string): FamilyLink[]
  linksByMember(memberId: string): FamilyLink[]
  allLinks(): FamilyLink[] // 管理后台总览
  findLink(id: string): FamilyLink | undefined
  deleteLink(id: string): void

  createBlock(block: Block): void
  deleteBlock(id: string): void
  findBlock(id: string): Block | undefined
  blocksInvolving(userId: string): Block[] // blockerId==userId 或 blockedId==userId 的所有拉黑记录
  allBlocks(): Block[] // 管理后台：全站拉黑记录

  createCallRecord(rec: CallRecord): void
  updateCallStatus(callId: string, calleeId: string, status: CallRecordStatus): void
  callRecordsForUser(userId: string, limit?: number): CallRecord[] // 我作为主叫或被叫，按时间倒序
  // 未看的未接来电数（我作为被叫、status='missed'、createdAt > sinceMs）——供未接来电角标（打开通话记录即清）。
  missedCallCountForUser(userId: string, sinceMs: number): number
  deleteCallRecordsForUser(userId: string): void // 删号级联：清该用户参与的全部通话记录（PII，非证据）
  deleteCallRecordsOlderThan(cutoffMs: number): number // 留存清扫：删除早于 cutoff 的通话记录（PII 数据最小化），返回条数
  allCallRecords(limit?: number): CallRecord[] // 管理后台：全站通话，按时间倒序

  createReport(report: Report): void
  allReports(): Report[]
  findReport(id: string): Report | undefined
  updateReport(id: string, patch: Partial<Report>): Report | undefined

  // 管理审计日志
  createAuditEntry(e: AdminAuditEntry): void
  allAuditEntries(limit?: number): AdminAuditEntry[] // 时间倒序

  // 用户警告（审核轻处置）
  createWarning(w: Warning): void
  warningsForUser(userId: string): Warning[] // 时间倒序

  // 全站运行配置
  getAppConfig(): AppConfig
  setAppConfig(patch: AppConfigPatch): AppConfig

  createRefreshToken(rt: RefreshToken): void
  findRefreshToken(tokenHash: string): RefreshToken | undefined
  deleteRefreshToken(tokenHash: string): void
  deleteRefreshTokensForUser(userId: string): void
  markRefreshTokenRotated(tokenHash: string, at: number): void // 轮换时留墓碑（供重放检测），不硬删
  deleteExpiredRefreshTokens(nowMs: number): number // 清扫过期 token（含墓碑），返回条数
  countSessionsForUser(userId: string, nowMs: number): number // 未过期 refresh token 数（活跃会话数，供后台展示）
  // 登录设备/会话管理
  sessionsForUser(userId: string, nowMs: number): SessionInfo[] // 该用户未过期的会话（按 sessionId，最近活动倒序）
  hasActiveSession(userId: string, sessionId: string, nowMs: number): boolean // 该会话是否仍有未过期 refresh token（撤销即令其 access 立即失效）
  revokeSession(userId: string, sessionId: string): void // 删除该会话的所有 refresh token（远程登出某设备）
  revokeOtherSessions(userId: string, keepSessionId: string): void // 删除除当前外的所有会话（登出其它设备）

  // 2FA 恢复码（一次性）：启用 2FA 时整批替换；登录时按哈希消费一个。
  replaceRecoveryCodes(userId: string, hashes: string[]): void // 整批替换（清旧 + 写新）
  consumeRecoveryCode(userId: string, codeHash: string, nowMs: number): boolean // 命中未用的码即标记已用并返回 true
  hasUnusedRecoveryCode(userId: string, codeHash: string): boolean // 仅检查存在未用的匹配码（不消费）——用于"两因子都成立后再消费"
  countUnusedRecoveryCodes(userId: string): number // 剩余可用恢复码数（账号页展示）
  deleteRecoveryCodesForUser(userId: string): void // 关闭 2FA 时清空

  // Passkey（WebAuthn）
  createPasskey(p: Passkey): void
  findPasskeyByCredentialId(credentialId: string): Passkey | undefined
  passkeysForUser(userId: string): Passkey[]
  updatePasskeyCounter(id: string, counter: number): void
  deletePasskey(id: string, userId: string): void

  getRecordingConfig(): RecordingConfig
  setRecordingConfig(patch: Partial<RecordingConfig>): RecordingConfig
  createSavedRoute(r: SavedRoute): void
  savedRoutesForUser(ownerId: string): SavedRoute[]      // 归属者的路线，updatedAt 倒序
  savedRoutesByCreator(creatorId: string): SavedRoute[]  // 我替别人画的路线（编辑入口）
  findSavedRoute(id: string): SavedRoute | undefined
  updateSavedRoute(id: string, patch: Partial<SavedRoute>): SavedRoute | undefined
  deleteSavedRoute(id: string): void
  deleteSavedRoutesForOwner(ownerId: string): void       // 删号级联（归属者维度）

  savedPlacesForUser(ownerId: string): SavedPlace[]      // 某人保存的地点，updatedAt 倒序
  upsertSavedPlace(p: SavedPlace): void                  // 按 (ownerId,label) 覆盖写（家/公司唯一）
  deleteSavedPlace(ownerId: string, label: string): void
  deleteSavedPlacesForOwner(ownerId: string): void       // 删号级联

  createSafetyTimer(t: SafetyTimer): void
  getSafetyTimer(id: string): SafetyTimer | undefined
  updateSafetyTimer(id: string, patch: Partial<SafetyTimer>): void // 读-合并-写（状态流转由调用方决定）
  activeSafetyTimerForOwner(ownerId: string): SafetyTimer | undefined // 某人当前进行中的报到（至多一个）
  safetyTimersForUser(ownerId: string): SafetyTimer[]    // 某人的报到历史，startedAt 倒序（自助导出/展示）
  expiredActiveSafetyTimers(now: number): SafetyTimer[]  // 到期候选：status=active ∧ dueAt≤now（供后台自动告警）
  dueSoonUnremindedSafetyTimers(now: number, leadMs: number): SafetyTimer[] // 即将到期未提醒：提前 leadMs 提醒本人防遗忘误报
  deleteSafetyTimersForOwner(ownerId: string): void      // 删号级联
  deleteSafetyTimersOlderThan(cutoffMs: number): number  // 留存清扫：仅清终态（非 active），按 startedAt

  getMedicalInfo(userId: string): MedicalInfo | undefined // 紧急医疗信息（加密信封，1:1）
  setMedicalInfo(m: MedicalInfo): void                    // 覆盖写（本人填写/更新）
  deleteMedicalInfoForUser(userId: string): void          // 本人清除 + 删号级联

  createRecording(rec: Recording): void
  allRecordings(): Recording[]
  recordingsForUser(ownerId: string): Recording[] // 某用户自己的录制（不含其软删除的），时间倒序——用户端"我的录音"
  findRecording(id: string): Recording | undefined
  recordingByMediaId(mediaId: string): Recording | undefined // 该媒体是否为某录制实体（通用媒体端点据此拒绝外泄录制）
  updateRecording(id: string, patch: Partial<Recording>): Recording | undefined // 软删除/补元数据
  reportsCitingRecording(recordingId: string): Report[] // 引用某录制作为证据的举报（留存保护用）
  deleteRecording(id: string): void

  // 实名认证（KYC）
  createVerification(v: Verification): void
  getActiveVerificationForUser(userId: string): Verification | undefined // 活跃记录（pending|verified），最新一条——一人一活跃守卫
  latestVerificationForUser(userId: string): Verification | undefined // 含 rejected 的最新一条——展示拒绝原因/可否重提
  findVerification(id: string): Verification | undefined
  listVerifications(status?: VerificationStatus, limit?: number): Verification[] // 审核队列，submittedAt 倒序
  updateVerification(id: string, patch: Partial<Verification>): Verification | undefined
  decideVerification(id: string, patch: Partial<Verification>): Verification | undefined // 条件更新：仅当 status==='pending' 才生效；竞态败者返回 undefined（恰好一次决策）
  countPendingVerifications(): number
  allVerifications(): Verification[] // 留存清扫用
  deleteVerificationsForUser(userId: string): void // 级联删除用

  // 站内通知（持久化收件箱）
  createNotification(n: Notification): void
  notificationsForUser(userId: string, limit?: number): Notification[] // 时间倒序
  findNotification(id: string): Notification | undefined
  markNotificationRead(id: string, userId: string): void // 仅本人可标记
  markAllNotificationsRead(userId: string): number
  unreadNotificationCount(userId: string): number
  deleteNotification(id: string, userId: string): boolean // 用户清理：删自己的单条通知（仅本人；不存在/非本人→false）
  deleteReadNotificationsForUser(userId: string): number // 用户清理：一键清空已读通知（保留未读），返回删除条数
  deleteNotificationsForUser(userId: string): void // 删号级联：清除该用户全部站内通知（GDPR 抹除）
  deleteNotificationsOlderThan(cutoffMs: number): number // 留存清扫：删除早于 cutoff 的通知，返回条数（数据最小化）
  // 紧急事件日志（治理）：
  createEmergencyEvent(e: EmergencyEvent): void
  recentEmergencyEvents(limit?: number): EmergencyEvent[] // 时间倒序
  emergencyEventsForUser(userId: string): EmergencyEvent[] // 本人事故记录（自助导出用，时间倒序）
  resolveOpenEmergencyEvents(userId: string, now: number): number // 报平安：标记该用户**全部**未解除事件为已解除，返回解除条数（报平安=本人已安全，其名下所有未决告警都该消，否则遗留的会被升级重呼误报）
  markEmergencyAcked(eventId: string, at: number): void   // 首个亲友确认：记 ackedAt（升级重呼据此跳过；后续确认不覆盖）
  markEmergencyEscalated(eventId: string, at: number): void // 升级重呼后标记，只升级一次
  unacknowledgedEmergencyEvents(olderThanAt: number, now: number): EmergencyEvent[] // 升级候选：未解除∧未确认∧未升级∧at≤olderThanAt
  deleteEmergencyEventsForUser(userId: string): void      // 删号级联（GDPR 抹除）
  deleteEmergencyEventsOlderThan(cutoffMs: number): number // 留存清扫
  // Web Push 订阅：
  upsertWebPushSubscription(sub: WebPushSubscription): void
  webPushSubscriptionsForUser(userId: string): WebPushSubscription[]
  findWebPushSubscription(endpoint: string): WebPushSubscription | undefined // 轮换验证用（按 endpoint 单查）
  deleteWebPushSubscription(endpoint: string): void
  deleteWebPushSubscriptionsForUser(userId: string): void // 删号级联
  clearWebPushSubscriptionFromOthers(endpoint: string, exceptUserId: string): void // 设备换账号：从旧账号收回

  createMessage(m: ChatMessage): void
  findMessage(id: string): ChatMessage | undefined
  updateMessage(id: string, patch: Partial<ChatMessage>): ChatMessage | undefined
  /// 双方之间的单聊消息（时间正序）；beforeMs/beforeId 用于向前翻页。
  /// beforeId：与 beforeMs 组成 (createdAt,id) 复合游标，边界遇同毫秒消息不漏（缺省退回严格 createdAt<beforeMs，向后兼容）。
  messagesBetween(a: string, b: string, limit: number, beforeMs?: number, beforeId?: string): ChatMessage[]
  /// 我参与的每个单聊对话的最后一条消息（按时间倒序），供会话列表。
  latestMessagesPerPeer(userId: string): ChatMessage[]
  /// 把 from→reader 的未读单聊消息标记已读，返回条数。
  markMessagesRead(readerId: string, fromId: string, at: number): number
  /// 来自 from 发给 user 的未读单聊条数。
  unreadCount(userId: string, fromId: string): number
  /// 删除某用户收发的全部消息（单聊双向 + 其在群里的发言）——账号删除级联用。
  deleteMessagesForUser(userId: string): void
  messagesSentBy(userId: string, limit: number): ChatMessage[] // 自助数据导出用（本人发出的消息，时间正序）

  // 群聊
  createGroup(g: ChatGroup): void
  findGroup(id: string): ChatGroup | undefined
  groupsFor(userId: string): ChatGroup[]
  updateGroup(id: string, patch: Partial<ChatGroup>): ChatGroup | undefined
  deleteGroup(id: string): void // 解散：同时删群消息与已读标记
  /// 群消息（时间正序，分页同 messagesBetween；beforeId 同义）。
  groupMessages(groupId: string, limit: number, beforeMs?: number, beforeId?: string): ChatMessage[]
  /// 会话内按关键词搜索**文本**消息（不区分大小写，时间倒序，最多 limit 条）。仅 kind=text 可搜。
  searchDirectMessages(a: string, b: string, query: string, limit: number): ChatMessage[]
  searchGroupMessages(groupId: string, query: string, limit: number): ChatMessage[]
  /// 跨会话全局搜索（WhatsApp 式）：该用户参与的**全部**单聊（本人为收/发方）+ 所在群的文本消息，
  /// 语义与上两者一致（不区分大小写、时间倒序、limit）。授权边界即"参与"本身——绝不含他人会话。
  searchAllMessagesFor(userId: string, query: string, limit: number): ChatMessage[]
  /// 群按人已读：记录/读取某人在某群"读到的时间戳"（群未读 = 晚于此且非本人发的消息数）。
  setGroupRead(groupId: string, userId: string, at: number): void
  groupReadAt(groupId: string, userId: string): number
  /// 某人在某群的未读数（createdAt>已读时刻、非己发、非撤回）——**无上限**高效计数。
  /// 与 unreadCount(单聊) 同为角标数据源；替代"取最近 N 条再 filter"的做法（后者 >N 条未读会漏计、且每次算角标都载 N 条消息体）。
  unreadGroupCount(groupId: string, userId: string): number
  deleteGroupReadsForUser(userId: string): void // 删号级联：清该用户在所有群的已读游标（非群主退群路径不经 deleteGroup，否则残留孤儿）
  /// 群免打扰：某人是否静音某群的推送横幅（消息仍存库、未读照增，只压推送）。与已读游标同为「每人每群」软状态。
  setGroupMuted(groupId: string, userId: string, muted: boolean): void
  isGroupMuted(groupId: string, userId: string): boolean
  groupMutesForUser(userId: string): string[] // 该用户静音的群 id 列表（GDPR 自助导出：免打扰偏好属本人主动配置的数据）
  deleteGroupMutesForUser(userId: string): void // 删号级联：清该用户在所有群的静音标记（同已读游标，非群主退群路径须显式清）
  /// 单聊免打扰：muter 是否静音了与 peer 的会话（只压推送横幅，消息/未读照常）。键为 (muter,peer) **有向**。
  setDmMuted(muterId: string, peerId: string, muted: boolean): void
  isDmMuted(muterId: string, peerId: string): boolean
  dmMutesForUser(userId: string): string[] // 该用户(作为 muter)静音单聊的对端 id 列表（GDPR 自助导出）
  deleteDmMutesForUser(userId: string): void // 删号级联：清该用户作为 muter **或** peer 的所有单聊静音（有向键两侧都涉及）

  // 媒体（视频消息等：元数据在库，实体文件在磁盘 media/）
  createMedia(m: MediaMeta): void
  findMedia(id: string): MediaMeta | undefined
  deleteMedia(id: string): void
  mediaByOwner(userId: string): MediaMeta[] // 某用户上传的全部媒体（删号级联清磁盘文件用）
  mediaBytesForOwner(userId: string): number // 某用户媒体总字节数（配额检查，防单账号撑爆磁盘）
  // AI 视觉每日配额：护外部付费视觉模型额度（10/min 限流只限速率、不限当日总量）。单行/用户，跨 UTC 日自动重置。
  visionCallsOnDay(userId: string, day: string): number // 该用户在 day(UTC yyyy-mm-dd)当日已成功的视觉调用次数
  recordVisionCall(userId: string, day: string): void   // 记一次成功调用（同日累加，跨日重置为 1）
  deleteVisionUsageForUser(userId: string): void        // 删号级联清计数
  allMedia(): MediaMeta[] // 全部媒体元数据（孤儿清扫遍历用）
  referencedMediaIds(): Set<string> // 被视频消息(kind=video,text=mediaId)或录制(mediaId)引用的全部 mediaId（孤儿清扫判定用）
  findVideoMessageByMediaId(mediaId: string): ChatMessage | undefined // 引用该 mediaId 的视频消息（媒体访问授权：能否看该媒体＝能否看引用它的那条消息）
}

/// 内存实现（测试用）。
export class MemoryStore implements Store {
  protected users = new Map<string, User>()
  protected links = new Map<string, FamilyLink>()
  protected blocks = new Map<string, Block>()
  protected callRecords = new Map<string, CallRecord>()
  protected reports = new Map<string, Report>()
  protected recordings = new Map<string, Recording>()
  protected savedRoutes = new Map<string, SavedRoute>()
  protected savedPlaces = new Map<string, SavedPlace>() // 键 = `${ownerId}\x00${label}`（复合唯一）
  protected safetyTimers = new Map<string, SafetyTimer>() // 键 = id（安全报到计时器）
  protected medicalInfo = new Map<string, MedicalInfo>()  // 键 = userId（紧急医疗信息，加密信封，1:1）
  protected verifications = new Map<string, Verification>()
  protected refreshTokens = new Map<string, RefreshToken>()
  protected recoveryCodes = new Map<string, RecoveryCode>() // 2FA 一次性恢复码（仅哈希），键为 id
  protected passkeys = new Map<string, Passkey>()
  protected messages = new Map<string, ChatMessage>()
  protected groups = new Map<string, ChatGroup>()
  protected groupReads = new Map<string, number>() // `${groupId}:${userId}` → lastReadAt
  protected groupMutes = new Set<string>() // `${groupId}:${userId}` 存在 = 该人静音该群推送
  protected dmMutes = new Set<string>() // `${muterId}:${peerId}` 存在 = muter 静音了与 peer 的单聊推送（有向）
  protected media = new Map<string, MediaMeta>()
  protected notifications = new Map<string, Notification>()
  protected emergencyEvents = new Map<string, EmergencyEvent>()
  protected webPushSubs = new Map<string, WebPushSubscription>()
  protected visionUsage = new Map<string, { day: string; count: number }>() // AI 视觉每日配额：单行/用户，跨日自动重置
  protected recordingConfig: RecordingConfig = { enabled: false, retentionDays: 7, requireConsent: true }
  protected auditLog: AdminAuditEntry[] = []
  protected warnings = new Map<string, Warning>()
  protected appConfig: AppConfig = { ...DEFAULT_APP_CONFIG, features: { ...DEFAULT_APP_CONFIG.features } }

  createRefreshToken(rt: RefreshToken): void {
    this.refreshTokens.set(rt.tokenHash, rt)
    this.afterMutate()
  }
  findRefreshToken(tokenHash: string): RefreshToken | undefined {
    return this.refreshTokens.get(tokenHash)
  }
  deleteRefreshToken(tokenHash: string): void {
    if (this.refreshTokens.delete(tokenHash)) this.afterMutate()
  }
  deleteRefreshTokensForUser(userId: string): void {
    let changed = false
    for (const [k, v] of this.refreshTokens) if (v.userId === userId) { this.refreshTokens.delete(k); changed = true }
    if (changed) this.afterMutate()
  }
  markRefreshTokenRotated(tokenHash: string, at: number): void {
    const rt = this.refreshTokens.get(tokenHash)
    if (rt) { this.refreshTokens.set(tokenHash, { ...rt, rotatedAt: at }); this.afterMutate() }
  }
  deleteExpiredRefreshTokens(nowMs: number): number {
    let n = 0
    for (const [k, v] of this.refreshTokens) if (v.expiresAt <= nowMs) { this.refreshTokens.delete(k); n++ }
    if (n) this.afterMutate()
    return n
  }
  countSessionsForUser(userId: string, nowMs: number): number {
    let n = 0
    for (const v of this.refreshTokens.values()) if (v.userId === userId && v.expiresAt > nowMs && v.rotatedAt == null) n++
    return n
  }
  sessionsForUser(userId: string, nowMs: number): SessionInfo[] {
    const out = new Map<string, SessionInfo>()
    for (const v of this.refreshTokens.values()) {
      if (v.userId !== userId || v.expiresAt <= nowMs || !v.sessionId || v.rotatedAt != null) continue
      const prev = out.get(v.sessionId)
      // 同会话理论上轮换后只剩一条；保险起见取最近活动的一条。
      if (!prev || (v.lastSeenAt ?? 0) > (prev.lastSeenAt ?? 0)) {
        out.set(v.sessionId, { sessionId: v.sessionId, deviceLabel: v.deviceLabel, createdAt: v.createdAt, lastSeenAt: v.lastSeenAt, expiresAt: v.expiresAt })
      }
    }
    return [...out.values()].sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
  }
  hasActiveSession(userId: string, sessionId: string, nowMs: number): boolean {
    for (const v of this.refreshTokens.values()) if (v.userId === userId && v.sessionId === sessionId && v.expiresAt > nowMs && v.rotatedAt == null) return true
    return false
  }
  revokeSession(userId: string, sessionId: string): void {
    let changed = false
    for (const [k, v] of this.refreshTokens) if (v.userId === userId && v.sessionId === sessionId) { this.refreshTokens.delete(k); changed = true }
    if (changed) this.afterMutate()
  }
  revokeOtherSessions(userId: string, keepSessionId: string): void {
    let changed = false
    for (const [k, v] of this.refreshTokens) if (v.userId === userId && v.sessionId !== keepSessionId) { this.refreshTokens.delete(k); changed = true }
    if (changed) this.afterMutate()
  }

  replaceRecoveryCodes(userId: string, hashes: string[]): void {
    for (const [k, v] of this.recoveryCodes) if (v.userId === userId) this.recoveryCodes.delete(k)
    let i = 0
    for (const h of hashes) {
      const id = `${userId}:${Date.now()}:${i++}`
      this.recoveryCodes.set(id, { id, userId, codeHash: h })
    }
    this.afterMutate()
  }
  consumeRecoveryCode(userId: string, codeHash: string, nowMs: number): boolean {
    for (const v of this.recoveryCodes.values()) {
      if (v.userId === userId && v.usedAt == null && v.codeHash === codeHash) {
        v.usedAt = nowMs
        this.afterMutate()
        return true
      }
    }
    return false
  }
  countUnusedRecoveryCodes(userId: string): number {
    let n = 0
    for (const v of this.recoveryCodes.values()) if (v.userId === userId && v.usedAt == null) n++
    return n
  }
  hasUnusedRecoveryCode(userId: string, codeHash: string): boolean {
    for (const v of this.recoveryCodes.values()) if (v.userId === userId && v.usedAt == null && v.codeHash === codeHash) return true
    return false
  }
  deleteRecoveryCodesForUser(userId: string): void {
    let changed = false
    for (const [k, v] of this.recoveryCodes) if (v.userId === userId) { this.recoveryCodes.delete(k); changed = true }
    if (changed) this.afterMutate()
  }

  createPasskey(p: Passkey): void {
    this.passkeys.set(p.id, p)
    this.afterMutate()
  }
  findPasskeyByCredentialId(credentialId: string): Passkey | undefined {
    for (const p of this.passkeys.values()) if (p.credentialId === credentialId) return p
    return undefined
  }
  passkeysForUser(userId: string): Passkey[] {
    // createdAt 降序：与生产 SqliteStore（ORDER BY createdAt DESC）一致（passkey 管理列表/账户导出的展示序）。
    return [...this.passkeys.values()].filter((p) => p.userId === userId).sort((a, b) => b.createdAt - a.createdAt)
  }
  updatePasskeyCounter(id: string, counter: number): void {
    const p = this.passkeys.get(id)
    if (p) { p.counter = counter; this.afterMutate() }
  }
  deletePasskey(id: string, userId: string): void {
    const p = this.passkeys.get(id)
    if (p && p.userId === userId && this.passkeys.delete(id)) this.afterMutate()
  }

  createUser(user: User): void {
    this.users.set(user.id, user)
    this.afterMutate()
  }
  findByUsername(username: string): User | undefined {
    // 大小写不敏感：防止注册"Alice"与"alice"两个混淆账号/冒充；登录也兼容任意大小写（见审查 #4）。
    const key = username.trim().toLowerCase()
    for (const u of this.users.values()) if (u.username.toLowerCase() === key) return u
    return undefined
  }
  findByPhone(phone: string): User | undefined {
    for (const u of this.users.values()) if (u.phone && u.phone === phone) return u
    return undefined
  }
  findByEmail(email: string): User | undefined {
    const key = email.trim().toLowerCase()
    if (key === '') return undefined
    for (const u of this.users.values()) if ((u.email ?? '').toLowerCase() === key) return u
    return undefined
  }
  findByAppleSub(appleSub: string): User | undefined {
    for (const u of this.users.values()) if (u.appleSub && u.appleSub === appleSub) return u
    return undefined
  }
  findById(id: string): User | undefined {
    return this.users.get(id)
  }
  allUsers(): User[] {
    return [...this.users.values()]
  }
  userCount(): number { return this.users.size }
  updateUser(id: string, patch: Partial<User>): User | undefined {
    const u = this.users.get(id)
    if (!u) return undefined
    const next = { ...u, ...patch, id: u.id }
    this.users.set(id, next)
    this.afterMutate()
    return next
  }
  deleteUser(id: string): void {
    if (this.users.delete(id)) this.afterMutate()
  }
  clearApnsTokenFromOthers(token: string, exceptUserId: string): void {
    let changed = false
    for (const u of this.users.values()) if (u.id !== exceptUserId && u.apnsToken === token) { u.apnsToken = undefined; changed = true }
    if (changed) this.afterMutate()
  }
  clearVoipTokenFromOthers(token: string, exceptUserId: string): void {
    let changed = false
    for (const u of this.users.values()) if (u.id !== exceptUserId && u.voipToken === token) { u.voipToken = undefined; changed = true }
    if (changed) this.afterMutate()
  }
  clearPushToken(token: string): void {
    let changed = false
    for (const u of this.users.values()) {
      if (u.apnsToken === token) { u.apnsToken = undefined; changed = true }
      if (u.voipToken === token) { u.voipToken = undefined; changed = true }
    }
    if (changed) this.afterMutate()
  }

  createLink(link: FamilyLink): void {
    this.links.set(link.id, link)
    this.afterMutate()
  }
  linksByOwner(ownerId: string): FamilyLink[] {
    return [...this.links.values()].filter((l) => l.ownerId === ownerId)
  }
  linksByMember(memberId: string): FamilyLink[] {
    return [...this.links.values()].filter((l) => l.memberId === memberId)
  }
  allLinks(): FamilyLink[] {
    // createdAt 降序：与生产 SqliteStore（ORDER BY createdAt DESC）一致。否则管理后台在测试(Memory，插入序)与
    // 线上(SQLite，最新在前)看到不同排序，且测试可能锁死 Memory 的插入序而线上悄悄不符（prod/test 分叉）。
    return [...this.links.values()].sort((a, b) => b.createdAt - a.createdAt)
  }
  findLink(id: string): FamilyLink | undefined {
    return this.links.get(id)
  }
  deleteLink(id: string): void {
    if (this.links.delete(id)) this.afterMutate()
  }

  createBlock(block: Block): void {
    this.blocks.set(block.id, block)
    this.afterMutate()
  }
  deleteBlock(id: string): void {
    if (this.blocks.delete(id)) this.afterMutate()
  }
  findBlock(id: string): Block | undefined {
    return this.blocks.get(id)
  }
  blocksInvolving(userId: string): Block[] {
    return [...this.blocks.values()].filter((b) => b.blockerId === userId || b.blockedId === userId)
  }
  allBlocks(): Block[] {
    return [...this.blocks.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  createCallRecord(rec: CallRecord): void {
    this.callRecords.set(rec.id, rec)
    this.afterMutate()
  }
  updateCallStatus(callId: string, calleeId: string, status: CallRecordStatus): void {
    let changed = false
    for (const r of this.callRecords.values()) {
      if (r.callId === callId && r.calleeId === calleeId) { r.status = status; changed = true }
    }
    if (changed) this.afterMutate()
  }
  callRecordsForUser(userId: string, limit = 100): CallRecord[] {
    return [...this.callRecords.values()]
      .filter((r) => r.callerId === userId || r.calleeId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
  }
  missedCallCountForUser(userId: string, sinceMs: number): number {
    let n = 0
    for (const r of this.callRecords.values()) {
      if (r.calleeId === userId && r.status === 'missed' && r.createdAt > sinceMs) n++
    }
    return n
  }
  deleteCallRecordsForUser(userId: string): void {
    let changed = false
    for (const [k, r] of this.callRecords) {
      if (r.callerId === userId || r.calleeId === userId) { this.callRecords.delete(k); changed = true }
    }
    if (changed) this.afterMutate()
  }
  deleteCallRecordsOlderThan(cutoffMs: number): number {
    let count = 0
    for (const [k, r] of this.callRecords) if (r.createdAt < cutoffMs) { this.callRecords.delete(k); count++ }
    if (count > 0) this.afterMutate()
    return count
  }
  allCallRecords(limit = 200): CallRecord[] {
    return [...this.callRecords.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
  }

  createReport(report: Report): void {
    this.reports.set(report.id, report)
    this.afterMutate()
  }
  allReports(): Report[] {
    return [...this.reports.values()]
  }
  findReport(id: string): Report | undefined {
    return this.reports.get(id)
  }
  updateReport(id: string, patch: Partial<Report>): Report | undefined {
    const r = this.reports.get(id)
    if (!r) return undefined
    const next = { ...r, ...patch, id: r.id }
    this.reports.set(id, next)
    this.afterMutate()
    return next
  }

  createAuditEntry(e: AdminAuditEntry): void {
    this.auditLog.push(e)
    if (this.auditLog.length > 10_000) this.auditLog.splice(0, this.auditLog.length - 10_000) // 防无限增长
    this.afterMutate()
  }
  allAuditEntries(limit = 200): AdminAuditEntry[] {
    return [...this.auditLog].sort((a, b) => b.at - a.at).slice(0, limit)
  }
  createWarning(w: Warning): void {
    this.warnings.set(w.id, w)
    this.afterMutate()
  }
  warningsForUser(userId: string): Warning[] {
    return [...this.warnings.values()].filter((w) => w.userId === userId).sort((a, b) => b.at - a.at)
  }
  getAppConfig(): AppConfig {
    return normalizeAppConfig(this.appConfig)
  }
  setAppConfig(patch: AppConfigPatch): AppConfig {
    this.appConfig = mergeAppConfig(normalizeAppConfig(this.appConfig), patch)
    this.afterMutate()
    return normalizeAppConfig(this.appConfig)
  }

  getRecordingConfig(): RecordingConfig {
    return { ...this.recordingConfig }
  }
  setRecordingConfig(patch: Partial<RecordingConfig>): RecordingConfig {
    this.recordingConfig = { ...this.recordingConfig, ...patch }
    this.afterMutate()
    return { ...this.recordingConfig }
  }
  createSavedRoute(r: SavedRoute): void {
    this.savedRoutes.set(r.id, r)
    this.afterMutate()
  }
  savedRoutesForUser(ownerId: string): SavedRoute[] {
    return [...this.savedRoutes.values()].filter((r) => r.ownerId === ownerId).sort((a, b) => b.updatedAt - a.updatedAt)
  }
  savedRoutesByCreator(creatorId: string): SavedRoute[] {
    return [...this.savedRoutes.values()].filter((r) => r.createdBy === creatorId).sort((a, b) => b.updatedAt - a.updatedAt)
  }
  findSavedRoute(id: string): SavedRoute | undefined {
    return this.savedRoutes.get(id)
  }
  updateSavedRoute(id: string, patch: Partial<SavedRoute>): SavedRoute | undefined {
    const r = this.savedRoutes.get(id)
    if (!r) return undefined
    const next = { ...r, ...patch, id: r.id, ownerId: r.ownerId, createdBy: r.createdBy } // 归属/绘制者不可改
    this.savedRoutes.set(id, next)
    this.afterMutate()
    return next
  }
  deleteSavedRoute(id: string): void {
    this.savedRoutes.delete(id)
    this.afterMutate()
  }
  deleteSavedRoutesForOwner(ownerId: string): void {
    for (const [k, v] of this.savedRoutes) if (v.ownerId === ownerId) this.savedRoutes.delete(k)
    this.afterMutate()
  }
  // 复合唯一键 (ownerId,label)：用 \x00 分隔（UUID/标签均不含 NUL，绝不碰撞）。
  // protected：JsonFileStore 载盘时必须复用**同一**键构造，否则写入(NUL)与查找(NUL)对不上
  // 会漏读——曾因载盘处内联成空格分隔键，重启后"家/公司"地址全部查不到（本次修复）。
  protected placeKey(ownerId: string, label: string): string { return `${ownerId}\x00${label}` }
  savedPlacesForUser(ownerId: string): SavedPlace[] {
    return [...this.savedPlaces.values()].filter((p) => p.ownerId === ownerId).sort((a, b) => b.updatedAt - a.updatedAt)
  }
  upsertSavedPlace(p: SavedPlace): void {
    this.savedPlaces.set(this.placeKey(p.ownerId, p.label), p) // (ownerId,label) 唯一：同 label 覆盖
    this.afterMutate()
  }
  deleteSavedPlace(ownerId: string, label: string): void {
    this.savedPlaces.delete(this.placeKey(ownerId, label))
    this.afterMutate()
  }
  deleteSavedPlacesForOwner(ownerId: string): void {
    for (const [k, v] of this.savedPlaces) if (v.ownerId === ownerId) this.savedPlaces.delete(k)
    this.afterMutate()
  }

  createSafetyTimer(t: SafetyTimer): void {
    this.safetyTimers.set(t.id, t)
    this.afterMutate()
  }
  getSafetyTimer(id: string): SafetyTimer | undefined {
    return this.safetyTimers.get(id)
  }
  updateSafetyTimer(id: string, patch: Partial<SafetyTimer>): void {
    const t = this.safetyTimers.get(id)
    if (!t) return
    this.safetyTimers.set(id, { ...t, ...patch })
    this.afterMutate()
  }
  activeSafetyTimerForOwner(ownerId: string): SafetyTimer | undefined {
    // 至多一个 active（start 时取消旧的）；若并存多个，取最近开始的（最新的意图）。
    return [...this.safetyTimers.values()]
      .filter((t) => t.ownerId === ownerId && t.status === 'active')
      .sort((a, b) => b.startedAt - a.startedAt)[0]
  }
  safetyTimersForUser(ownerId: string): SafetyTimer[] {
    return [...this.safetyTimers.values()].filter((t) => t.ownerId === ownerId).sort((a, b) => b.startedAt - a.startedAt)
  }
  expiredActiveSafetyTimers(now: number): SafetyTimer[] {
    return [...this.safetyTimers.values()]
      .filter((t) => t.status === 'active' && t.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt)
  }
  dueSoonUnremindedSafetyTimers(now: number, leadMs: number): SafetyTimer[] {
    return [...this.safetyTimers.values()]
      .filter((t) => t.status === 'active' && t.remindedAt == null
        // 仅对"总时长 > 提前量"的计时器提醒：短计时器(如 5min，用户正盯着)提前 10min 提醒会在创建即触发、纯噪声。
        && t.dueAt - t.startedAt > leadMs
        // 进入提前窗口 [dueAt-leadMs, dueAt)：已到期(≥dueAt)交由 expiredActiveSafetyTimers 告警，不在此重复处理。
        && now >= t.dueAt - leadMs && now < t.dueAt)
      .sort((a, b) => a.dueAt - b.dueAt)
  }
  deleteSafetyTimersForOwner(ownerId: string): void {
    let changed = false
    for (const [k, t] of this.safetyTimers) if (t.ownerId === ownerId) { this.safetyTimers.delete(k); changed = true }
    if (changed) this.afterMutate()
  }
  deleteSafetyTimersOlderThan(cutoffMs: number): number {
    let n = 0
    // 只清终态：active 无论多老都保留（免误删待触发的报到；宕机后迟到的由自动告警的宽限逻辑处理）。
    for (const [k, t] of this.safetyTimers) if (t.status !== 'active' && t.startedAt < cutoffMs) { this.safetyTimers.delete(k); n++ }
    if (n) this.afterMutate()
    return n
  }

  getMedicalInfo(userId: string): MedicalInfo | undefined { return this.medicalInfo.get(userId) }
  setMedicalInfo(m: MedicalInfo): void { this.medicalInfo.set(m.userId, m); this.afterMutate() }
  deleteMedicalInfoForUser(userId: string): void { if (this.medicalInfo.delete(userId)) this.afterMutate() }

  createRecording(rec: Recording): void {
    this.recordings.set(rec.id, rec)
    this.afterMutate()
  }
  allRecordings(): Recording[] {
    return [...this.recordings.values()]
  }
  recordingsForUser(ownerId: string): Recording[] {
    return [...this.recordings.values()]
      .filter((r) => r.ownerId === ownerId && r.deletedAt == null)
      .sort((a, b) => b.recordedAt - a.recordedAt)
  }
  findRecording(id: string): Recording | undefined {
    return this.recordings.get(id)
  }
  recordingByMediaId(mediaId: string): Recording | undefined {
    for (const r of this.recordings.values()) if (r.mediaId === mediaId) return r
    return undefined
  }
  updateRecording(id: string, patch: Partial<Recording>): Recording | undefined {
    const r = this.recordings.get(id)
    if (!r) return undefined
    const next = { ...r, ...patch, id: r.id }
    this.recordings.set(id, next)
    this.afterMutate()
    return next
  }
  reportsCitingRecording(recordingId: string): Report[] {
    return [...this.reports.values()].filter((r) => r.evidenceRecordingId === recordingId)
  }
  createVerification(v: Verification): void {
    this.verifications.set(v.id, v)
    this.afterMutate()
  }
  getActiveVerificationForUser(userId: string): Verification | undefined {
    return [...this.verifications.values()]
      .filter((v) => v.userId === userId && (v.status === 'pending' || v.status === 'verified'))
      .sort((a, b) => b.submittedAt - a.submittedAt)[0]
  }
  latestVerificationForUser(userId: string): Verification | undefined {
    return [...this.verifications.values()]
      .filter((v) => v.userId === userId)
      .sort((a, b) => b.submittedAt - a.submittedAt)[0]
  }
  findVerification(id: string): Verification | undefined {
    return this.verifications.get(id)
  }
  listVerifications(status?: VerificationStatus, limit?: number): Verification[] {
    const all = [...this.verifications.values()]
      .filter((v) => (status ? v.status === status : true))
      .sort((a, b) => b.submittedAt - a.submittedAt)
    return limit != null ? all.slice(0, limit) : all
  }
  updateVerification(id: string, patch: Partial<Verification>): Verification | undefined {
    const v = this.verifications.get(id)
    if (!v) return undefined
    const next = { ...v, ...patch, id: v.id }
    this.verifications.set(id, next)
    this.afterMutate()
    return next
  }
  decideVerification(id: string, patch: Partial<Verification>): Verification | undefined {
    const v = this.verifications.get(id)
    if (!v || v.status !== 'pending') return undefined // 条件更新：只对 pending 生效；竞态败者返回 undefined
    const next = { ...v, ...patch, id: v.id }
    this.verifications.set(id, next)
    this.afterMutate()
    return next
  }
  countPendingVerifications(): number {
    let n = 0
    for (const v of this.verifications.values()) if (v.status === 'pending') n++
    return n
  }
  allVerifications(): Verification[] {
    return [...this.verifications.values()]
  }
  deleteVerificationsForUser(userId: string): void {
    // 法务保留(legalHold)的记录刻意保留为取证证据（与级联删号保留 举报/警告 同理）；其余删除。
    let changed = false
    for (const [id, v] of this.verifications) if (v.userId === userId && !v.legalHold) { this.verifications.delete(id); changed = true }
    if (changed) this.afterMutate()
  }
  deleteRecording(id: string): void {
    if (this.recordings.delete(id)) this.afterMutate()
  }

  // MARK: 站内通知
  createNotification(n: Notification): void {
    this.notifications.set(n.id, n)
    this.afterMutate()
  }
  notificationsForUser(userId: string, limit = 100): Notification[] {
    return [...this.notifications.values()]
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
  }
  findNotification(id: string): Notification | undefined {
    return this.notifications.get(id)
  }
  markNotificationRead(id: string, userId: string): void {
    const n = this.notifications.get(id)
    if (n && n.userId === userId && n.readAt == null) { n.readAt = Date.now(); this.afterMutate() }
  }
  markAllNotificationsRead(userId: string): number {
    let count = 0
    const now = Date.now()
    for (const n of this.notifications.values()) {
      if (n.userId === userId && n.readAt == null) { n.readAt = now; count++ }
    }
    if (count > 0) this.afterMutate()
    return count
  }
  unreadNotificationCount(userId: string): number {
    let n = 0
    for (const x of this.notifications.values()) if (x.userId === userId && x.readAt == null) n++
    return n
  }
  deleteNotification(id: string, userId: string): boolean {
    const n = this.notifications.get(id)
    if (!n || n.userId !== userId) return false // 仅本人；不存在/非本人一律 false（不泄露他人通知存在性）
    this.notifications.delete(id)
    this.afterMutate()
    return true
  }
  deleteReadNotificationsForUser(userId: string): number {
    let count = 0
    for (const [id, n] of this.notifications) {
      if (n.userId === userId && n.readAt != null) { this.notifications.delete(id); count++ }
    }
    if (count > 0) this.afterMutate()
    return count
  }
  deleteNotificationsForUser(userId: string): void {
    let changed = false
    for (const [k, n] of this.notifications) if (n.userId === userId) { this.notifications.delete(k); changed = true }
    if (changed) this.afterMutate()
  }
  deleteNotificationsOlderThan(cutoffMs: number): number {
    let n = 0
    for (const [id, notif] of this.notifications) {
      if (notif.createdAt < cutoffMs) { this.notifications.delete(id); n++ }
    }
    if (n) this.afterMutate()
    return n
  }
  createEmergencyEvent(e: EmergencyEvent): void {
    this.emergencyEvents.set(e.id, e)
    this.afterMutate()
  }
  recentEmergencyEvents(limit = 100): EmergencyEvent[] {
    return [...this.emergencyEvents.values()].sort((a, b) => b.at - a.at).slice(0, Math.max(0, limit))
  }
  emergencyEventsForUser(userId: string): EmergencyEvent[] {
    return [...this.emergencyEvents.values()].filter((e) => e.userId === userId).sort((a, b) => b.at - a.at)
  }
  resolveOpenEmergencyEvents(userId: string, now: number): number {
    // 报平安 = 本人已安全，其名下**全部**未解除告警都应解除。此前只解除"最近一条"：若同时有多条未决
    // （如自动摔倒检测 + 手动 SOS 各建一条事件），报一次平安只消掉最新那条，遗留的旧事件几分钟后被升级重呼
    // 二次误报"X 仍需帮助"——协助者在 X 已说安全后仍被惊动（与客户端 clearedSenderLatest 的按发起人语义对齐）。
    let n = 0
    for (const e of this.emergencyEvents.values()) {
      if (e.userId === userId && e.resolvedAt == null) { e.resolvedAt = now; n++ }
    }
    if (n > 0) this.afterMutate()
    return n
  }
  markEmergencyAcked(eventId: string, at: number): void {
    const e = this.emergencyEvents.get(eventId)
    if (e && e.ackedAt == null) { e.ackedAt = at; this.afterMutate() } // 只记首个确认
  }
  markEmergencyEscalated(eventId: string, at: number): void {
    const e = this.emergencyEvents.get(eventId)
    if (e) { e.escalatedAt = at; this.afterMutate() }
  }
  unacknowledgedEmergencyEvents(olderThanAt: number, now: number): EmergencyEvent[] {
    return [...this.emergencyEvents.values()]
      .filter((e) => e.resolvedAt == null && e.ackedAt == null && e.escalatedAt == null && e.at <= olderThanAt)
      .sort((a, b) => a.at - b.at)
  }
  deleteEmergencyEventsForUser(userId: string): void {
    let changed = false
    for (const [k, e] of this.emergencyEvents) if (e.userId === userId) { this.emergencyEvents.delete(k); changed = true }
    if (changed) this.afterMutate()
  }
  deleteEmergencyEventsOlderThan(cutoffMs: number): number {
    let n = 0
    for (const [k, e] of this.emergencyEvents) if (e.at < cutoffMs) { this.emergencyEvents.delete(k); n++ }
    if (n) this.afterMutate()
    return n
  }
  upsertWebPushSubscription(sub: WebPushSubscription): void {
    this.webPushSubs.set(sub.endpoint, sub)
    this.afterMutate()
  }
  webPushSubscriptionsForUser(userId: string): WebPushSubscription[] {
    return [...this.webPushSubs.values()].filter((s) => s.userId === userId)
  }
  findWebPushSubscription(endpoint: string): WebPushSubscription | undefined {
    return this.webPushSubs.get(endpoint)
  }
  deleteWebPushSubscription(endpoint: string): void {
    if (this.webPushSubs.delete(endpoint)) this.afterMutate()
  }
  deleteWebPushSubscriptionsForUser(userId: string): void {
    let changed = false
    for (const [k, v] of this.webPushSubs) if (v.userId === userId) { this.webPushSubs.delete(k); changed = true }
    if (changed) this.afterMutate()
  }
  clearWebPushSubscriptionFromOthers(endpoint: string, exceptUserId: string): void {
    const cur = this.webPushSubs.get(endpoint)
    if (cur && cur.userId !== exceptUserId) { this.webPushSubs.delete(endpoint); this.afterMutate() }
  }

  createMessage(m: ChatMessage): void {
    this.messages.set(m.id, m)
    this.afterMutate()
  }
  findMessage(id: string): ChatMessage | undefined {
    return this.messages.get(id)
  }
  updateMessage(id: string, patch: Partial<ChatMessage>): ChatMessage | undefined {
    const cur = this.messages.get(id)
    if (!cur) return undefined
    const next = { ...cur, ...patch, id: cur.id }
    this.messages.set(id, next)
    this.afterMutate()
    return next
  }
  messagesBetween(a: string, b: string, limit: number, beforeMs?: number, beforeId?: string): ChatMessage[] {
    const all = [...this.messages.values()]
      .filter((m) => !m.groupId)
      .filter((m) => (m.fromId === a && m.toId === b) || (m.fromId === b && m.toId === a))
      .filter((m) => beforeCursor(m, beforeMs, beforeId))
      .sort(byTimeThenId)
    return all.slice(Math.max(0, all.length - limit))
  }
  latestMessagesPerPeer(userId: string): ChatMessage[] {
    const latest = new Map<string, ChatMessage>()
    for (const m of this.messages.values()) {
      if (m.groupId) continue // 群消息不入单聊会话列表
      if (m.fromId !== userId && m.toId !== userId) continue
      const peer = m.fromId === userId ? m.toId : m.fromId
      const cur = latest.get(peer)
      // 取每对端 (createdAt,id) 最大的那条为"最新"——同毫秒也确定唯一，与 SqliteStore 口径一致。
      if (!cur || byTimeThenId(m, cur) > 0) latest.set(peer, m)
    }
    return [...latest.values()].sort((x, y) => -byTimeThenId(x, y))
  }
  markMessagesRead(readerId: string, fromId: string, at: number): number {
    let n = 0
    for (const m of this.messages.values()) {
      if (m.toId === readerId && m.fromId === fromId && m.readAt == null) { m.readAt = at; n++ }
    }
    if (n > 0) this.afterMutate()
    return n
  }
  unreadCount(userId: string, fromId: string): number {
    let n = 0
    for (const m of this.messages.values()) {
      // 排除已撤回（kind=recalled）：撤回消息无内容可读，不应计未读（与群未读口径一致）。
      if (m.toId === userId && m.fromId === fromId && m.readAt == null && m.kind !== 'recalled') n++
    }
    return n
  }
  unreadGroupCount(groupId: string, userId: string): number {
    const readAt = this.groupReadAt(groupId, userId)
    let n = 0
    for (const m of this.messages.values()) {
      if (m.groupId === groupId && m.createdAt > readAt && m.fromId !== userId && m.kind !== 'recalled') n++
    }
    return n
  }
  deleteMessagesForUser(userId: string): void {
    let changed = false
    for (const [k, m] of this.messages) if (m.fromId === userId || m.toId === userId) { this.messages.delete(k); changed = true }
    if (changed) this.afterMutate()
  }
  messagesSentBy(userId: string, limit: number): ChatMessage[] {
    return [...this.messages.values()].filter((m) => m.fromId === userId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0, Math.max(0, limit))
  }

  // MARK: 群聊
  createGroup(g: ChatGroup): void {
    this.groups.set(g.id, g)
    this.afterMutate()
  }
  findGroup(id: string): ChatGroup | undefined {
    return this.groups.get(id)
  }
  groupsFor(userId: string): ChatGroup[] {
    return [...this.groups.values()].filter((g) => g.memberIds.includes(userId))
  }
  updateGroup(id: string, patch: Partial<ChatGroup>): ChatGroup | undefined {
    const cur = this.groups.get(id)
    if (!cur) return undefined
    const next = { ...cur, ...patch, id: cur.id }
    this.groups.set(id, next)
    this.afterMutate()
    return next
  }
  deleteGroup(id: string): void {
    this.groups.delete(id)
    for (const [k, m] of this.messages) if (m.groupId === id) this.messages.delete(k)
    for (const k of [...this.groupReads.keys()]) if (k.startsWith(`${id}:`)) this.groupReads.delete(k)
    for (const k of [...this.groupMutes]) if (k.startsWith(`${id}:`)) this.groupMutes.delete(k)
    this.afterMutate()
  }
  groupMessages(groupId: string, limit: number, beforeMs?: number, beforeId?: string): ChatMessage[] {
    const all = [...this.messages.values()]
      .filter((m) => m.groupId === groupId)
      .filter((m) => beforeCursor(m, beforeMs, beforeId))
      .sort(byTimeThenId)
    return all.slice(Math.max(0, all.length - limit))
  }
  searchDirectMessages(a: string, b: string, query: string, limit: number): ChatMessage[] {
    const q = query.trim().toLowerCase()
    if (q === '') return []
    return [...this.messages.values()]
      .filter((m) => !m.groupId && m.kind === 'text')
      .filter((m) => (m.fromId === a && m.toId === b) || (m.fromId === b && m.toId === a))
      .filter((m) => m.text.toLowerCase().includes(q))
      .sort((x, y) => y.createdAt - x.createdAt || y.id.localeCompare(x.id)) // (createdAt,id) 稳定序，与 SqliteStore 一致
      .slice(0, limit)
  }
  searchGroupMessages(groupId: string, query: string, limit: number): ChatMessage[] {
    const q = query.trim().toLowerCase()
    if (q === '') return []
    return [...this.messages.values()]
      .filter((m) => m.groupId === groupId && m.kind === 'text')
      .filter((m) => m.text.toLowerCase().includes(q))
      .sort((x, y) => y.createdAt - x.createdAt || y.id.localeCompare(x.id)) // (createdAt,id) 稳定序，与 SqliteStore 一致
      .slice(0, limit)
  }
  searchAllMessagesFor(userId: string, query: string, limit: number): ChatMessage[] {
    const q = query.trim().toLowerCase()
    if (q === '') return []
    // 授权边界=参与：单聊须本人为收/发方；群消息须本人此刻在群成员表里（退群/被移出后不再可搜其历史，与群消息读取一致）。
    const myGroups = new Set([...this.groups.values()].filter((g) => g.memberIds.includes(userId)).map((g) => g.id))
    return [...this.messages.values()]
      .filter((m) => m.kind === 'text')
      .filter((m) => (m.groupId ? myGroups.has(m.groupId) : m.fromId === userId || m.toId === userId))
      .filter((m) => m.text.toLowerCase().includes(q))
      .sort((x, y) => y.createdAt - x.createdAt || y.id.localeCompare(x.id)) // (createdAt,id) 稳定序，与 SqliteStore 一致
      .slice(0, limit)
  }
  setGroupRead(groupId: string, userId: string, at: number): void {
    this.groupReads.set(`${groupId}:${userId}`, at)
    this.afterMutate()
  }
  groupReadAt(groupId: string, userId: string): number {
    return this.groupReads.get(`${groupId}:${userId}`) ?? 0
  }
  deleteGroupReadsForUser(userId: string): void {
    let changed = false
    // key = `${groupId}:${userId}`（groupId/userId 均为 UUID，无冒号），故按 `:${userId}` 结尾唯一匹配该用户。
    for (const k of [...this.groupReads.keys()]) if (k.endsWith(`:${userId}`)) { this.groupReads.delete(k); changed = true }
    if (changed) this.afterMutate()
  }
  setGroupMuted(groupId: string, userId: string, muted: boolean): void {
    const k = `${groupId}:${userId}`
    if (muted ? (this.groupMutes.has(k) ? false : (this.groupMutes.add(k), true)) : this.groupMutes.delete(k)) this.afterMutate()
  }
  isGroupMuted(groupId: string, userId: string): boolean {
    return this.groupMutes.has(`${groupId}:${userId}`)
  }
  groupMutesForUser(userId: string): string[] {
    // 键 `${groupId}:${userId}`：取后缀=本人的，还原前缀 groupId（UUID 无冒号，切分唯一；与 delete 的 endsWith 同口径）。
    return [...this.groupMutes].filter((k) => k.endsWith(`:${userId}`)).map((k) => k.slice(0, k.length - userId.length - 1))
  }
  deleteGroupMutesForUser(userId: string): void {
    let changed = false
    for (const k of [...this.groupMutes]) if (k.endsWith(`:${userId}`)) { this.groupMutes.delete(k); changed = true }
    if (changed) this.afterMutate()
  }
  setDmMuted(muterId: string, peerId: string, muted: boolean): void {
    const k = `${muterId}:${peerId}`
    if (muted ? (this.dmMutes.has(k) ? false : (this.dmMutes.add(k), true)) : this.dmMutes.delete(k)) this.afterMutate()
  }
  isDmMuted(muterId: string, peerId: string): boolean {
    return this.dmMutes.has(`${muterId}:${peerId}`)
  }
  dmMutesForUser(userId: string): string[] {
    // 有向键 `${muter}:${peer}`：取前缀=本人(作为 muter)的，还原后缀 peerId（导出"本人静音了谁"，非"谁静音了本人"）。
    return [...this.dmMutes].filter((k) => k.startsWith(`${userId}:`)).map((k) => k.slice(userId.length + 1))
  }
  deleteDmMutesForUser(userId: string): void {
    let changed = false
    // 有向键 `${muter}:${peer}`：该用户作为 muter（前缀）或 peer（后缀）的都清（UUID 无冒号，前后缀唯一）。
    for (const k of [...this.dmMutes]) if (k.startsWith(`${userId}:`) || k.endsWith(`:${userId}`)) { this.dmMutes.delete(k); changed = true }
    if (changed) this.afterMutate()
  }

  // MARK: 媒体
  createMedia(m: MediaMeta): void {
    this.media.set(m.id, m)
    this.afterMutate()
  }
  findMedia(id: string): MediaMeta | undefined {
    return this.media.get(id)
  }
  deleteMedia(id: string): void {
    if (this.media.delete(id)) this.afterMutate()
  }
  mediaByOwner(userId: string): MediaMeta[] {
    return [...this.media.values()].filter((m) => m.ownerId === userId)
  }
  mediaBytesForOwner(userId: string): number {
    let total = 0
    for (const m of this.media.values()) if (m.ownerId === userId) total += m.size
    return total
  }
  visionCallsOnDay(userId: string, day: string): number {
    const e = this.visionUsage.get(userId)
    return e && e.day === day ? e.count : 0 // 跨日的旧行视为 0（下次 record 会重置）
  }
  recordVisionCall(userId: string, day: string): void {
    const e = this.visionUsage.get(userId)
    if (e && e.day === day) e.count += 1
    else this.visionUsage.set(userId, { day, count: 1 }) // 新用户或跨日：重置为 1
    this.afterMutate()
  }
  deleteVisionUsageForUser(userId: string): void {
    if (this.visionUsage.delete(userId)) this.afterMutate()
  }
  allMedia(): MediaMeta[] {
    return [...this.media.values()]
  }
  referencedMediaIds(): Set<string> {
    const s = new Set<string>()
    for (const m of this.messages.values()) if (m.kind === 'video' && m.text) s.add(m.text)
    for (const r of this.recordings.values()) if (r.mediaId) s.add(r.mediaId)
    return s
  }
  findVideoMessageByMediaId(mediaId: string): ChatMessage | undefined {
    for (const m of this.messages.values()) if (m.kind === 'video' && m.text === mediaId) return m
    return undefined
  }

  protected afterMutate(): void { /* 内存无需持久化 */ }
}

/// JSON 文件实现（自托管持久化，零原生依赖）。
export class JsonFileStore extends MemoryStore {
  constructor(private path: string) {
    super()
    if (existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, 'utf8')) as {
          users?: User[]
          links?: FamilyLink[]
          blocks?: Block[]
          callRecords?: CallRecord[]
          reports?: Report[]
          recordings?: Recording[]
          verifications?: Verification[]
          refreshTokens?: RefreshToken[]
          recoveryCodes?: RecoveryCode[]
          recordingConfig?: RecordingConfig
          messages?: ChatMessage[]
          groups?: ChatGroup[]
          groupReads?: Record<string, number>
          groupMutes?: string[]
          dmMutes?: string[]
          media?: MediaMeta[]
          passkeys?: Passkey[]
          auditLog?: AdminAuditEntry[]
          warnings?: Warning[]
          appConfig?: AppConfig
          notifications?: Notification[]
          savedRoutes?: SavedRoute[]
          savedPlaces?: SavedPlace[]
          safetyTimers?: SafetyTimer[]
          medicalInfo?: MedicalInfo[]
          emergencyEvents?: EmergencyEvent[]
          webPushSubs?: WebPushSubscription[]
          visionUsage?: Record<string, { day: string; count: number }>
        }
        for (const u of data.users ?? []) this.users.set(u.id, u)
        for (const l of data.links ?? []) this.links.set(l.id, l)
        for (const b of data.blocks ?? []) this.blocks.set(b.id, b)
        for (const c of data.callRecords ?? []) this.callRecords.set(c.id, c)
        for (const r of data.reports ?? []) this.reports.set(r.id, r)
        for (const rec of data.recordings ?? []) this.recordings.set(rec.id, rec)
        for (const v of data.verifications ?? []) this.verifications.set(v.id, v)
        for (const rt of data.refreshTokens ?? []) this.refreshTokens.set(rt.tokenHash, rt)
        for (const rc of data.recoveryCodes ?? []) this.recoveryCodes.set(rc.id, rc)
        if (data.recordingConfig) this.recordingConfig = data.recordingConfig
        for (const m of data.messages ?? []) this.messages.set(m.id, m)
        for (const g of data.groups ?? []) this.groups.set(g.id, g)
        for (const [k, v] of Object.entries(data.groupReads ?? {})) this.groupReads.set(k, v)
        for (const k of data.groupMutes ?? []) this.groupMutes.add(k)
        for (const k of data.dmMutes ?? []) this.dmMutes.add(k)
        for (const md of data.media ?? []) this.media.set(md.id, md)
        for (const pk of data.passkeys ?? []) this.passkeys.set(pk.id, pk)
        if (data.auditLog) this.auditLog = data.auditLog
        for (const w of data.warnings ?? []) this.warnings.set(w.id, w)
        if (data.appConfig) this.appConfig = data.appConfig
        for (const n of data.notifications ?? []) this.notifications.set(n.id, n)
        for (const sr of data.savedRoutes ?? []) this.savedRoutes.set(sr.id, sr)
        for (const sp of data.savedPlaces ?? []) this.savedPlaces.set(this.placeKey(sp.ownerId, sp.label), sp)
        for (const st of data.safetyTimers ?? []) this.safetyTimers.set(st.id, st)
        for (const mi of data.medicalInfo ?? []) this.medicalInfo.set(mi.userId, mi)
        for (const ee of data.emergencyEvents ?? []) this.emergencyEvents.set(ee.id, ee)
        for (const wp of data.webPushSubs ?? []) this.webPushSubs.set(wp.endpoint, wp)
        for (const [k, v] of Object.entries(data.visionUsage ?? {})) this.visionUsage.set(k, v)
      } catch {
        /* 损坏的文件忽略，从空开始 */
      }
    }
  }

  protected override afterMutate(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const data = {
      users: [...this.users.values()],
      links: [...this.links.values()],
      blocks: [...this.blocks.values()],
      callRecords: [...this.callRecords.values()],
      reports: [...this.reports.values()],
      recordings: [...this.recordings.values()],
      verifications: [...this.verifications.values()],
      refreshTokens: [...this.refreshTokens.values()],
      recoveryCodes: [...this.recoveryCodes.values()],
      recordingConfig: this.recordingConfig,
      messages: [...this.messages.values()],
      groups: [...this.groups.values()],
      groupReads: Object.fromEntries(this.groupReads),
      groupMutes: [...this.groupMutes],
      dmMutes: [...this.dmMutes],
      media: [...this.media.values()],
      passkeys: [...this.passkeys.values()],
      auditLog: this.auditLog,
      warnings: [...this.warnings.values()],
      appConfig: this.appConfig,
      notifications: [...this.notifications.values()],
      savedRoutes: [...this.savedRoutes.values()],
      savedPlaces: [...this.savedPlaces.values()],
      safetyTimers: [...this.safetyTimers.values()],
      medicalInfo: [...this.medicalInfo.values()],
      emergencyEvents: [...this.emergencyEvents.values()],
      webPushSubs: [...this.webPushSubs.values()],
      visionUsage: Object.fromEntries(this.visionUsage),
    }
    // 原子写：先写临时文件再 rename 覆盖。writeFileSync 直写在写入中途崩溃/断电/磁盘满时会留下**半写**
    // 的 JSON——下次启动 JSON.parse 失败→构造函数按"损坏忽略、从空开始"处理→**静默全量丢数据**。
    // rename 在同一文件系统上是原子的：主文件永远是上一次或本次的完整内容，绝不半写。
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    renameSync(tmp, this.path)
  }
}

/// 与某用户**互为**黑名单的所有对方 userId 集合（任一方向拉黑都算）。供匹配/队列/呼叫排除。
export function blockedUserIdSet(store: Store, userId: string): Set<string> {
  const s = new Set<string>()
  for (const b of store.blocksInvolving(userId)) s.add(b.blockerId === userId ? b.blockedId : b.blockerId)
  return s
}

/// a 与 b 之间是否存在任一方向的拉黑。
export function isBlockedBetween(store: Store, a: string, b: string): boolean {
  return store.blocksInvolving(a).some(
    (blk) => (blk.blockerId === a && blk.blockedId === b) || (blk.blockerId === b && blk.blockedId === a),
  )
}

/// a 与 b 是否互为**已接受**绑定（任一方向）。media/消息/群成员等可达性判定共用——
/// 单点定义，避免各路由各拷一份导致"accepted 口径/方向"漂移（曾在 groups/media/messages 三处重复）。
export function areLinked(store: Store, a: string, b: string): boolean {
  const ok = (l: { status?: string }) => (l.status ?? 'accepted') === 'accepted'
  return store.linksByOwner(a).some((l) => l.memberId === b && ok(l))
    || store.linksByMember(a).some((l) => l.ownerId === b && ok(l))
}

/// 我的"互为 accepted 绑定"联系人 id 集（双向 owner∪member），排除任一方向拉黑者。
/// 位置共享可见集 / 定向呼叫可达目标等共用——单点定义"可达联系人"口径（曾在 assist/locations 重复）。
export function acceptedContactIds(store: Store, me: string): Set<string> {
  const ok = (l: { status?: string }) => (l.status ?? 'accepted') === 'accepted'
  const ids = new Set<string>()
  for (const l of store.linksByOwner(me)) if (ok(l)) ids.add(l.memberId)
  for (const l of store.linksByMember(me)) if (ok(l)) ids.add(l.ownerId)
  for (const id of blockedUserIdSet(store, me)) ids.delete(id)
  return ids
}

/// 登录/找回标识解析：兼容用户名 / 归一化手机号 / 邮箱（含 @ 才试）。**登录与找回密码共用同一口径**
/// ——否则二者漂移：找回若只认用户名，则用邮箱/手机号注册（用户名是自动生成、用户根本不知道）的人无从找回密码。
export function findByLoginIdentifier(store: Store, identifier: string): User | undefined {
  const byUsername = store.findByUsername(identifier)
  if (byUsername) return byUsername
  const p = normalizePhone(identifier)
  if (p) { const byPhone = store.findByPhone(p); if (byPhone) return byPhone }
  if (identifier.includes('@')) return store.findByEmail(identifier)
  return undefined
}

/// 对外暴露的安全用户字段（不含 passwordHash / email；用于管理员列表、亲友等场景）。
export function publicUser(u: User) {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, status: u.status, avatar: u.avatar ?? null, verified: u.identityVerified ?? false }
}

/// 本人视图（/api/me）：在 publicUser 基础上加自己的邮箱/手机号/语言/验证状态（仅本人可见）。
export function selfView(u: User) {
  return {
    ...publicUser(u),
    language: u.language ?? null,
    email: u.email ?? null,
    emailVerified: u.emailVerified ?? false,
    phone: u.phone ?? null,
    usernameCustomized: u.usernameCustomized ?? false, // 为 false 时客户端提示设置唯一 userid
    appleLinked: !!u.appleSub, // 是否已绑定 Apple ID（用于账号页展示与解绑）
    twoFactorEnabled: !!u.totpEnabled, // 是否已开启两步验证（客户端账号页展示开关态；绝不返回 totpSecret）
    legalConsentVersion: u.legalConsentVersion ?? null, // 已同意的隐私/条款版本（客户端据此门控注册/重新同意）
    legalConsentAt: u.legalConsentAt ?? null,
    helperGuidelineAckAt: u.helperGuidelineAckAt ?? null, // 协助者守则确认时间（null=客户端首次协助前展示守则卡）
  }
}
