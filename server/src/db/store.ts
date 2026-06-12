import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

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
}

/// 举报（通话后一键举报 → 管理员审核）。
export type ReportStatus = 'open' | 'resolved'
export interface Report {
  id: string
  reporterId: string
  targetUserId: string
  callId?: string
  reason: string
  status: ReportStatus
  createdAt: number
}

/// refresh token（仅存哈希，轮换+撤销）。
export interface RefreshToken {
  tokenHash: string
  userId: string
  expiresAt: number
}

/// 录制策略（Q6）：默认不录、需同意、到期自动删。
export interface RecordingConfig {
  enabled: boolean
  retentionDays: number
  requireConsent: boolean
}

/// 一条录制的元数据（媒体文件本身由客户端/录制器处理，这里只管元数据与留存）。
export interface Recording {
  id: string
  callId: string
  ownerId: string
  consentBy: string[]
  reason: string
  recordedAt: number
}

/// 聊天消息（单聊=accepted 绑定互发；群聊=群成员互发）。
/// kind=audio/image 时 text 为 data URL；kind=video 时 text 为 mediaId（服务器磁盘文件）；
/// kind=recalled 为已撤回占位（text 清空）。
export interface ChatMessage {
  id: string
  fromId: string
  toId: string        // 单聊收件人；群消息为 ''（以 groupId 寻址）
  kind: 'text' | 'audio' | 'image' | 'video' | 'recalled'
  text: string
  createdAt: number
  readAt?: number // 单聊：收件人已读时间（已读回执）。群聊不用此字段（见 groupReads）
  reaction?: string // 表情回应（WhatsApp 式，单个 emoji，最新覆盖；空=无）
  groupId?: string // 群消息所属群
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
  createUser(user: User): void
  findByUsername(username: string): User | undefined
  findByPhone(phone: string): User | undefined       // 手机号登录（归一化后精确匹配）
  findByEmail(email: string): User | undefined       // 邮箱登录（大小写不敏感）
  findByAppleSub(appleSub: string): User | undefined // Sign in with Apple 账号匹配
  findById(id: string): User | undefined
  allUsers(): User[]
  updateUser(id: string, patch: Partial<User>): User | undefined
  deleteUser(id: string): void

  createLink(link: FamilyLink): void
  linksByOwner(ownerId: string): FamilyLink[]
  linksByMember(memberId: string): FamilyLink[]
  findLink(id: string): FamilyLink | undefined
  deleteLink(id: string): void

  createBlock(block: Block): void
  deleteBlock(id: string): void
  findBlock(id: string): Block | undefined
  blocksInvolving(userId: string): Block[] // blockerId==userId 或 blockedId==userId 的所有拉黑记录

  createCallRecord(rec: CallRecord): void
  updateCallStatus(callId: string, calleeId: string, status: CallRecordStatus): void
  callRecordsForUser(userId: string, limit?: number): CallRecord[] // 我作为主叫或被叫，按时间倒序

  createReport(report: Report): void
  allReports(): Report[]
  findReport(id: string): Report | undefined
  updateReport(id: string, patch: Partial<Report>): Report | undefined

  createRefreshToken(rt: RefreshToken): void
  findRefreshToken(tokenHash: string): RefreshToken | undefined
  deleteRefreshToken(tokenHash: string): void
  deleteRefreshTokensForUser(userId: string): void

  getRecordingConfig(): RecordingConfig
  setRecordingConfig(patch: Partial<RecordingConfig>): RecordingConfig
  createRecording(rec: Recording): void
  allRecordings(): Recording[]
  findRecording(id: string): Recording | undefined
  deleteRecording(id: string): void

  createMessage(m: ChatMessage): void
  findMessage(id: string): ChatMessage | undefined
  updateMessage(id: string, patch: Partial<ChatMessage>): ChatMessage | undefined
  /// 双方之间的单聊消息（时间正序）；beforeMs 用于向前翻页（只取早于该时刻的最后 limit 条）。
  messagesBetween(a: string, b: string, limit: number, beforeMs?: number): ChatMessage[]
  /// 我参与的每个单聊对话的最后一条消息（按时间倒序），供会话列表。
  latestMessagesPerPeer(userId: string): ChatMessage[]
  /// 把 from→reader 的未读单聊消息标记已读，返回条数。
  markMessagesRead(readerId: string, fromId: string, at: number): number
  /// 来自 from 发给 user 的未读单聊条数。
  unreadCount(userId: string, fromId: string): number

  // 群聊
  createGroup(g: ChatGroup): void
  findGroup(id: string): ChatGroup | undefined
  groupsFor(userId: string): ChatGroup[]
  updateGroup(id: string, patch: Partial<ChatGroup>): ChatGroup | undefined
  deleteGroup(id: string): void // 解散：同时删群消息与已读标记
  /// 群消息（时间正序，分页同 messagesBetween）。
  groupMessages(groupId: string, limit: number, beforeMs?: number): ChatMessage[]
  /// 群按人已读：记录/读取某人在某群"读到的时间戳"（群未读 = 晚于此且非本人发的消息数）。
  setGroupRead(groupId: string, userId: string, at: number): void
  groupReadAt(groupId: string, userId: string): number

  // 媒体（视频消息等：元数据在库，实体文件在磁盘 media/）
  createMedia(m: MediaMeta): void
  findMedia(id: string): MediaMeta | undefined
  deleteMedia(id: string): void
}

/// 内存实现（测试用）。
export class MemoryStore implements Store {
  protected users = new Map<string, User>()
  protected links = new Map<string, FamilyLink>()
  protected blocks = new Map<string, Block>()
  protected callRecords = new Map<string, CallRecord>()
  protected reports = new Map<string, Report>()
  protected recordings = new Map<string, Recording>()
  protected refreshTokens = new Map<string, RefreshToken>()
  protected messages = new Map<string, ChatMessage>()
  protected groups = new Map<string, ChatGroup>()
  protected groupReads = new Map<string, number>() // `${groupId}:${userId}` → lastReadAt
  protected media = new Map<string, MediaMeta>()
  protected recordingConfig: RecordingConfig = { enabled: false, retentionDays: 7, requireConsent: true }

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

  getRecordingConfig(): RecordingConfig {
    return { ...this.recordingConfig }
  }
  setRecordingConfig(patch: Partial<RecordingConfig>): RecordingConfig {
    this.recordingConfig = { ...this.recordingConfig, ...patch }
    this.afterMutate()
    return { ...this.recordingConfig }
  }
  createRecording(rec: Recording): void {
    this.recordings.set(rec.id, rec)
    this.afterMutate()
  }
  allRecordings(): Recording[] {
    return [...this.recordings.values()]
  }
  findRecording(id: string): Recording | undefined {
    return this.recordings.get(id)
  }
  deleteRecording(id: string): void {
    if (this.recordings.delete(id)) this.afterMutate()
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
  messagesBetween(a: string, b: string, limit: number, beforeMs?: number): ChatMessage[] {
    const all = [...this.messages.values()]
      .filter((m) => !m.groupId)
      .filter((m) => (m.fromId === a && m.toId === b) || (m.fromId === b && m.toId === a))
      .filter((m) => beforeMs == null || m.createdAt < beforeMs)
      .sort((x, y) => x.createdAt - y.createdAt)
    return all.slice(Math.max(0, all.length - limit))
  }
  latestMessagesPerPeer(userId: string): ChatMessage[] {
    const latest = new Map<string, ChatMessage>()
    for (const m of this.messages.values()) {
      if (m.groupId) continue // 群消息不入单聊会话列表
      if (m.fromId !== userId && m.toId !== userId) continue
      const peer = m.fromId === userId ? m.toId : m.fromId
      const cur = latest.get(peer)
      if (!cur || m.createdAt > cur.createdAt) latest.set(peer, m)
    }
    return [...latest.values()].sort((x, y) => y.createdAt - x.createdAt)
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
      if (m.toId === userId && m.fromId === fromId && m.readAt == null) n++
    }
    return n
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
    this.afterMutate()
  }
  groupMessages(groupId: string, limit: number, beforeMs?: number): ChatMessage[] {
    const all = [...this.messages.values()]
      .filter((m) => m.groupId === groupId)
      .filter((m) => beforeMs == null || m.createdAt < beforeMs)
      .sort((x, y) => x.createdAt - y.createdAt)
    return all.slice(Math.max(0, all.length - limit))
  }
  setGroupRead(groupId: string, userId: string, at: number): void {
    this.groupReads.set(`${groupId}:${userId}`, at)
    this.afterMutate()
  }
  groupReadAt(groupId: string, userId: string): number {
    return this.groupReads.get(`${groupId}:${userId}`) ?? 0
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
          refreshTokens?: RefreshToken[]
          recordingConfig?: RecordingConfig
          messages?: ChatMessage[]
          groups?: ChatGroup[]
          groupReads?: Record<string, number>
          media?: MediaMeta[]
        }
        for (const u of data.users ?? []) this.users.set(u.id, u)
        for (const l of data.links ?? []) this.links.set(l.id, l)
        for (const b of data.blocks ?? []) this.blocks.set(b.id, b)
        for (const c of data.callRecords ?? []) this.callRecords.set(c.id, c)
        for (const r of data.reports ?? []) this.reports.set(r.id, r)
        for (const rec of data.recordings ?? []) this.recordings.set(rec.id, rec)
        for (const rt of data.refreshTokens ?? []) this.refreshTokens.set(rt.tokenHash, rt)
        if (data.recordingConfig) this.recordingConfig = data.recordingConfig
        for (const m of data.messages ?? []) this.messages.set(m.id, m)
        for (const g of data.groups ?? []) this.groups.set(g.id, g)
        for (const [k, v] of Object.entries(data.groupReads ?? {})) this.groupReads.set(k, v)
        for (const md of data.media ?? []) this.media.set(md.id, md)
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
      refreshTokens: [...this.refreshTokens.values()],
      recordingConfig: this.recordingConfig,
      messages: [...this.messages.values()],
      groups: [...this.groups.values()],
      groupReads: Object.fromEntries(this.groupReads),
      media: [...this.media.values()],
    }
    writeFileSync(this.path, JSON.stringify(data, null, 2))
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

/// 对外暴露的安全用户字段（不含 passwordHash / email；用于管理员列表、亲友等场景）。
export function publicUser(u: User) {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, status: u.status, avatar: u.avatar ?? null }
}

/// 本人视图（/api/me）：在 publicUser 基础上加自己的邮箱/手机号/语言/验证状态（仅本人可见）。
export function selfView(u: User) {
  return {
    ...publicUser(u),
    language: u.language ?? null,
    email: u.email ?? null,
    emailVerified: u.emailVerified ?? false,
    phone: u.phone ?? null,
  }
}
