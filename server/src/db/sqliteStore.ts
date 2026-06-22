import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Store, User, Role, UserStatus, FamilyLink, LinkStatus, Block, CallRecord, CallRecordStatus, Report, ReportStatus, Recording, RecordingConfig, RefreshToken, SessionInfo, ChatMessage, ChatGroup, MediaMeta, Passkey, AdminAuditEntry, Warning, AppConfig, AppConfigPatch, Notification } from './store'
import { normalizeAppConfig, mergeAppConfig } from './store'

// 用运行时 require + 非静态模块名加载 node:sqlite，避免打包器(vitest/vite)静态解析失败；
// 由 Node 在运行时解析（需 --experimental-sqlite，已在 npm 脚本里通过 NODE_OPTIONS 开启）。
const nodeRequire = createRequire(import.meta.url)
const sqliteModuleName = ['node', 'sqlite'].join(':')
const { DatabaseSync } = nodeRequire(sqliteModuleName) as { DatabaseSync: typeof DatabaseSyncType }

/// 容错 JSON 解析：损坏/非法 JSON（如直接改库或磁盘损坏）返回 fallback 而非抛出，
/// 避免一行坏数据让整条请求 500。配置类用 fallback=默认对象，可空字段用 undefined。
function parseJsonOr<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback
  try { return (JSON.parse(raw) as T) ?? fallback } catch { return fallback }
}
function parseJsonOrUndefined<T>(raw: unknown): T | undefined { return parseJsonOr<T | undefined>(raw, undefined) }

/// SQLite 持久化（用 Node 内置 `node:sqlite`，零原生依赖；需 --experimental-sqlite）。
/// 与 Store 接口对齐，可平滑替换 JSON 文件存储。
export class SqliteStore implements Store {
  private db: DatabaseSyncType

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE, passwordHash TEXT,
        displayName TEXT, role TEXT, status TEXT, createdAt INTEGER, language TEXT, tokenVersion INTEGER);
      CREATE TABLE IF NOT EXISTS links (
        id TEXT PRIMARY KEY, ownerId TEXT, memberId TEXT, relation TEXT,
        isEmergency INTEGER, phone TEXT, createdAt INTEGER, status TEXT);
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY, reporterId TEXT, targetUserId TEXT, callId TEXT,
        reason TEXT, status TEXT, createdAt INTEGER);
      CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY, callId TEXT, ownerId TEXT, consentBy TEXT,
        reason TEXT, recordedAt INTEGER);
      CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        tokenHash TEXT PRIMARY KEY, userId TEXT, expiresAt INTEGER);
      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY, blockerId TEXT, blockedId TEXT, createdAt INTEGER);
      CREATE TABLE IF NOT EXISTS call_records (
        id TEXT PRIMARY KEY, callId TEXT, callerId TEXT, calleeId TEXT, status TEXT, createdAt INTEGER);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, fromId TEXT, toId TEXT, kind TEXT, text TEXT, createdAt INTEGER, readAt INTEGER, reaction TEXT, groupId TEXT);
      CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages (fromId, toId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_messages_to ON messages (toId, readAt);
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY, name TEXT, ownerId TEXT, memberIds TEXT, createdAt INTEGER);
      CREATE TABLE IF NOT EXISTS group_reads (
        groupId TEXT, userId TEXT, lastReadAt INTEGER, PRIMARY KEY (groupId, userId));
      CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY, ownerId TEXT, mime TEXT, size INTEGER, createdAt INTEGER);
      CREATE TABLE IF NOT EXISTS passkeys (
        id TEXT PRIMARY KEY, userId TEXT, credentialId TEXT UNIQUE, publicKey TEXT, counter INTEGER, deviceName TEXT, createdAt INTEGER);
      CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys (userId);
    `)
    // 迁移：旧库 links 表补 phone 列、users 表补 language 列（已存在则忽略）。
    try { this.db.exec('ALTER TABLE links ADD COLUMN phone TEXT') } catch { /* 列已存在 */ }
    try { this.db.exec('ALTER TABLE users ADD COLUMN language TEXT') } catch { /* 列已存在 */ }
    try { this.db.exec('ALTER TABLE users ADD COLUMN tokenVersion INTEGER') } catch { /* 列已存在 */ } // 改密/封禁令旧 token 失效（见审查 #2）
    try { this.db.exec('ALTER TABLE links ADD COLUMN status TEXT') } catch { /* 列已存在 */ } // 绑定双向同意 pending/accepted（见审查 #6）
    try { this.db.exec('ALTER TABLE users ADD COLUMN email TEXT') } catch { /* 列已存在 */ } // 邮箱验证/找回密码（D1）
    try { this.db.exec('ALTER TABLE users ADD COLUMN emailVerified INTEGER') } catch { /* 列已存在 */ }
    try { this.db.exec('ALTER TABLE users ADD COLUMN voipToken TEXT') } catch { /* 列已存在 */ } // PushKit VoIP 后台来电（A1）
    try { this.db.exec('ALTER TABLE links ADD COLUMN requestedBy TEXT') } catch { /* 列已存在 */ } // 双向加好友：记录请求发起方
    try { this.db.exec('ALTER TABLE users ADD COLUMN avatar TEXT') } catch { /* 列已存在 */ } // 头像 data URL
    try { this.db.exec('ALTER TABLE users ADD COLUMN apnsToken TEXT') } catch { /* 列已存在 */ } // 普通 APNs 提醒推送 token
    try { this.db.exec('ALTER TABLE users ADD COLUMN phone TEXT') } catch { /* 列已存在 */ } // 手机号登录标识
    try { this.db.exec('ALTER TABLE users ADD COLUMN appleSub TEXT') } catch { /* 列已存在 */ } // Sign in with Apple sub
    try { this.db.exec('ALTER TABLE users ADD COLUMN usernameCustomized INTEGER') } catch { /* 列已存在 */ } // 是否设过自定义用户名
    try { this.db.exec('ALTER TABLE users ADD COLUMN legalConsentVersion TEXT') } catch { /* 列已存在 */ } // 同意的隐私/条款版本（注册门控+GDPR 可证明同意）
    try { this.db.exec('ALTER TABLE users ADD COLUMN legalConsentAt INTEGER') } catch { /* 列已存在 */ } // 同意时间戳
    try { this.db.exec('ALTER TABLE users ADD COLUMN featureOverrides TEXT') } catch { /* 列已存在 */ } // 单用户功能覆盖（JSON）
    try { this.db.exec('ALTER TABLE users ADD COLUMN totpSecret TEXT') } catch { /* 列已存在 */ } // 2FA TOTP base32 密钥（仅服务端校验）
    try { this.db.exec('ALTER TABLE users ADD COLUMN totpEnabled INTEGER') } catch { /* 列已存在 */ } // 2FA 是否已启用
    try { this.db.exec('ALTER TABLE users ADD COLUMN totpLastCounter INTEGER') } catch { /* 列已存在 */ } // TOTP 单次使用防重放
    try { this.db.exec('ALTER TABLE recordings ADD COLUMN mediaId TEXT') } catch { /* 列已存在 */ } // 录制关联的媒体文件
    try { this.db.exec('ALTER TABLE messages ADD COLUMN reaction TEXT') } catch { /* 列已存在 */ } // 表情回应
    try { this.db.exec('ALTER TABLE messages ADD COLUMN groupId TEXT') } catch { /* 列已存在 */ } // 群消息
    // 群消息索引必须在 groupId 列迁移之后建——否则旧库（无此列）在 CREATE INDEX 处直接崩。
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_messages_group ON messages (groupId, createdAt)')
    // Admin v3：审核处置 + 审计日志 + 用户警告
    try { this.db.exec('ALTER TABLE reports ADD COLUMN decision TEXT') } catch { /* 列已存在 */ }
    try { this.db.exec('ALTER TABLE reports ADD COLUMN resolvedBy TEXT') } catch { /* 列已存在 */ }
    try { this.db.exec('ALTER TABLE reports ADD COLUMN resolvedAt INTEGER') } catch { /* 列已存在 */ }
    this.db.exec('CREATE TABLE IF NOT EXISTS admin_audit (id TEXT PRIMARY KEY, adminId TEXT, action TEXT, targetType TEXT, targetId TEXT, detail TEXT, at INTEGER)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_audit_at ON admin_audit (at)')
    this.db.exec('CREATE TABLE IF NOT EXISTS warnings (id TEXT PRIMARY KEY, userId TEXT, reason TEXT, byAdminId TEXT, reportId TEXT, at INTEGER)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_warn_user ON warnings (userId, at)')
    // 录制详细元数据（时间地点人+时长）+ 用户软删除（合规留存）。
    try { this.db.exec('ALTER TABLE recordings ADD COLUMN participants TEXT') } catch { /* 列已存在 */ } // JSON string[]
    try { this.db.exec('ALTER TABLE recordings ADD COLUMN durationSec INTEGER') } catch { /* 列已存在 */ }
    try { this.db.exec('ALTER TABLE recordings ADD COLUMN lat REAL') } catch { /* 列已存在 */ }
    try { this.db.exec('ALTER TABLE recordings ADD COLUMN lon REAL') } catch { /* 列已存在 */ }
    try { this.db.exec('ALTER TABLE recordings ADD COLUMN locationLabel TEXT') } catch { /* 列已存在 */ }
    try { this.db.exec('ALTER TABLE recordings ADD COLUMN deletedAt INTEGER') } catch { /* 列已存在 */ } // 用户软删除（管理员留存期内仍可见）
    // 举报证据：关联录制。
    try { this.db.exec('ALTER TABLE reports ADD COLUMN evidenceRecordingId TEXT') } catch { /* 列已存在 */ }
    // 站内通知（持久化收件箱）。
    this.db.exec('CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, userId TEXT, kind TEXT, title TEXT, body TEXT, dataJson TEXT, createdAt INTEGER, readAt INTEGER)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (userId, createdAt)')
    // 2FA 一次性恢复码（仅存 SHA-256 哈希）。
    this.db.exec('CREATE TABLE IF NOT EXISTS recovery_codes (id TEXT PRIMARY KEY, userId TEXT, codeHash TEXT, usedAt INTEGER)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes (userId)')
    // 登录会话/设备：在 refresh_tokens 上加会话标识与设备/时间元数据（增量迁移）。
    try { this.db.exec('ALTER TABLE refresh_tokens ADD COLUMN sessionId TEXT') } catch { /* 列已存在 */ }
    try { this.db.exec('ALTER TABLE refresh_tokens ADD COLUMN deviceLabel TEXT') } catch { /* 列已存在 */ }
    try { this.db.exec('ALTER TABLE refresh_tokens ADD COLUMN createdAt INTEGER') } catch { /* 列已存在 */ }
    try { this.db.exec('ALTER TABLE refresh_tokens ADD COLUMN lastSeenAt INTEGER') } catch { /* 列已存在 */ }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens (userId)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_refresh_session ON refresh_tokens (userId, sessionId)')
  }

  // MARK: refresh tokens
  createRefreshToken(rt: RefreshToken): void {
    this.db.prepare('INSERT OR REPLACE INTO refresh_tokens (tokenHash, userId, expiresAt, sessionId, deviceLabel, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(rt.tokenHash, rt.userId, rt.expiresAt, rt.sessionId ?? null, rt.deviceLabel ?? null, rt.createdAt ?? null, rt.lastSeenAt ?? null)
  }
  findRefreshToken(tokenHash: string): RefreshToken | undefined {
    const row = this.db.prepare('SELECT * FROM refresh_tokens WHERE tokenHash = ?').get(tokenHash) as any
    return row ? { tokenHash: row.tokenHash, userId: row.userId, expiresAt: Number(row.expiresAt), sessionId: row.sessionId ?? undefined, deviceLabel: row.deviceLabel ?? undefined, createdAt: row.createdAt != null ? Number(row.createdAt) : undefined, lastSeenAt: row.lastSeenAt != null ? Number(row.lastSeenAt) : undefined } : undefined
  }
  deleteRefreshToken(tokenHash: string): void {
    this.db.prepare('DELETE FROM refresh_tokens WHERE tokenHash = ?').run(tokenHash)
  }
  deleteRefreshTokensForUser(userId: string): void {
    this.db.prepare('DELETE FROM refresh_tokens WHERE userId = ?').run(userId)
  }
  countSessionsForUser(userId: string, nowMs: number): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE userId = ? AND expiresAt > ?').get(userId, nowMs) as { n: number }
    return Number(row.n)
  }
  sessionsForUser(userId: string, nowMs: number): SessionInfo[] {
    const rows = this.db.prepare(
      `SELECT sessionId, MAX(deviceLabel) AS deviceLabel, MIN(createdAt) AS createdAt, MAX(lastSeenAt) AS lastSeenAt, MAX(expiresAt) AS expiresAt
       FROM refresh_tokens WHERE userId = ? AND expiresAt > ? AND sessionId IS NOT NULL
       GROUP BY sessionId ORDER BY lastSeenAt DESC`,
    ).all(userId, nowMs) as any[]
    return rows.map((r) => ({ sessionId: r.sessionId, deviceLabel: r.deviceLabel ?? undefined, createdAt: r.createdAt != null ? Number(r.createdAt) : undefined, lastSeenAt: r.lastSeenAt != null ? Number(r.lastSeenAt) : undefined, expiresAt: Number(r.expiresAt) }))
  }
  hasActiveSession(userId: string, sessionId: string, nowMs: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM refresh_tokens WHERE userId = ? AND sessionId = ? AND expiresAt > ? LIMIT 1').get(userId, sessionId, nowMs)
  }
  revokeSession(userId: string, sessionId: string): void {
    this.db.prepare('DELETE FROM refresh_tokens WHERE userId = ? AND sessionId = ?').run(userId, sessionId)
  }
  revokeOtherSessions(userId: string, keepSessionId: string): void {
    this.db.prepare('DELETE FROM refresh_tokens WHERE userId = ? AND sessionId != ?').run(userId, keepSessionId)
  }

  // MARK: 2FA 恢复码
  replaceRecoveryCodes(userId: string, hashes: string[]): void {
    const del = this.db.prepare('DELETE FROM recovery_codes WHERE userId = ?')
    const ins = this.db.prepare('INSERT INTO recovery_codes (id, userId, codeHash, usedAt) VALUES (?, ?, ?, NULL)')
    del.run(userId)
    let i = 0
    for (const h of hashes) ins.run(`${userId}:${Date.now()}:${i++}`, userId, h)
  }
  consumeRecoveryCode(userId: string, codeHash: string, nowMs: number): boolean {
    // 仅命中"未用"的码才置为已用；用受影响行数判断是否消费成功（一次性）。
    const res = this.db.prepare('UPDATE recovery_codes SET usedAt = ? WHERE userId = ? AND codeHash = ? AND usedAt IS NULL').run(nowMs, userId, codeHash)
    return Number(res.changes) > 0
  }
  countUnusedRecoveryCodes(userId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE userId = ? AND usedAt IS NULL').get(userId) as { n: number }
    return Number(row.n)
  }
  hasUnusedRecoveryCode(userId: string, codeHash: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM recovery_codes WHERE userId = ? AND codeHash = ? AND usedAt IS NULL LIMIT 1').get(userId, codeHash)
  }
  deleteRecoveryCodesForUser(userId: string): void {
    this.db.prepare('DELETE FROM recovery_codes WHERE userId = ?').run(userId)
  }

  // MARK: passkeys（WebAuthn）
  createPasskey(p: Passkey): void {
    this.db.prepare('INSERT OR REPLACE INTO passkeys (id, userId, credentialId, publicKey, counter, deviceName, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(p.id, p.userId, p.credentialId, p.publicKey, p.counter, p.deviceName ?? null, p.createdAt)
  }
  findPasskeyByCredentialId(credentialId: string): Passkey | undefined {
    const row = this.db.prepare('SELECT * FROM passkeys WHERE credentialId = ?').get(credentialId) as any
    return row ? this.toPasskey(row) : undefined
  }
  passkeysForUser(userId: string): Passkey[] {
    return this.db.prepare('SELECT * FROM passkeys WHERE userId = ? ORDER BY createdAt DESC').all(userId).map((r) => this.toPasskey(r))
  }
  updatePasskeyCounter(id: string, counter: number): void {
    this.db.prepare('UPDATE passkeys SET counter = ? WHERE id = ?').run(counter, id)
  }
  deletePasskey(id: string, userId: string): void {
    this.db.prepare('DELETE FROM passkeys WHERE id = ? AND userId = ?').run(id, userId)
  }
  private toPasskey(r: any): Passkey {
    return { id: r.id, userId: r.userId, credentialId: r.credentialId, publicKey: r.publicKey, counter: Number(r.counter), deviceName: r.deviceName ?? undefined, createdAt: Number(r.createdAt) }
  }

  // MARK: users
  createUser(u: User): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO users (id, username, passwordHash, displayName, role, status, createdAt, language, tokenVersion, email, emailVerified, voipToken, avatar, apnsToken, phone, appleSub, usernameCustomized, legalConsentVersion, legalConsentAt, featureOverrides, totpSecret, totpEnabled, totpLastCounter)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(u.id, u.username, u.passwordHash, u.displayName, u.role, u.status, u.createdAt, u.language ?? null, u.tokenVersion ?? 0, u.email ?? null, u.emailVerified ? 1 : 0, u.voipToken ?? null, u.avatar ?? null, u.apnsToken ?? null, u.phone ?? null, u.appleSub ?? null, u.usernameCustomized ? 1 : 0, u.legalConsentVersion ?? null, u.legalConsentAt ?? null, u.featureOverrides ? JSON.stringify(u.featureOverrides) : null, u.totpSecret ?? null, u.totpEnabled ? 1 : 0, u.totpLastCounter ?? null)
  }
  findByUsername(username: string): User | undefined {
    // 大小写不敏感(COLLATE NOCASE)：防同名混淆/冒充；登录兼容任意大小写（见审查 #4）。
    const row = this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username.trim())
    return row ? this.toUser(row) : undefined
  }
  findByPhone(phone: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE phone = ?').get(phone)
    return row ? this.toUser(row) : undefined
  }
  findByEmail(email: string): User | undefined {
    const key = email.trim().toLowerCase()
    if (key === '') return undefined
    // 邮箱注册/绑定时已统一小写存储；NOCASE 兜底兼容历史大小写混存。
    const row = this.db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(key)
    return row ? this.toUser(row) : undefined
  }
  findByAppleSub(appleSub: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE appleSub = ?').get(appleSub)
    return row ? this.toUser(row) : undefined
  }
  findById(id: string): User | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    return row ? this.toUser(row) : undefined
  }
  allUsers(): User[] {
    return this.db.prepare('SELECT * FROM users').all().map((r) => this.toUser(r))
  }
  updateUser(id: string, patch: Partial<User>): User | undefined {
    const cur = this.findById(id)
    if (!cur) return undefined
    const next = { ...cur, ...patch, id: cur.id }
    this.createUser(next)
    return next
  }
  deleteUser(id: string): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id)
  }

  // MARK: links
  createLink(l: FamilyLink): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO links (id, ownerId, memberId, relation, isEmergency, phone, createdAt, status, requestedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(l.id, l.ownerId, l.memberId, l.relation, l.isEmergency ? 1 : 0, l.phone ?? null, l.createdAt, l.status ?? null, l.requestedBy ?? null)
  }
  linksByOwner(ownerId: string): FamilyLink[] {
    return this.db.prepare('SELECT * FROM links WHERE ownerId = ?').all(ownerId).map((r) => this.toLink(r))
  }
  linksByMember(memberId: string): FamilyLink[] {
    return this.db.prepare('SELECT * FROM links WHERE memberId = ?').all(memberId).map((r) => this.toLink(r))
  }
  allLinks(): FamilyLink[] {
    return this.db.prepare('SELECT * FROM links ORDER BY createdAt DESC').all().map((r) => this.toLink(r))
  }
  findLink(id: string): FamilyLink | undefined {
    const row = this.db.prepare('SELECT * FROM links WHERE id = ?').get(id)
    return row ? this.toLink(row) : undefined
  }
  deleteLink(id: string): void {
    this.db.prepare('DELETE FROM links WHERE id = ?').run(id)
  }

  // MARK: blocks
  createBlock(b: Block): void {
    this.db.prepare('INSERT OR REPLACE INTO blocks (id, blockerId, blockedId, createdAt) VALUES (?, ?, ?, ?)')
      .run(b.id, b.blockerId, b.blockedId, b.createdAt)
  }
  deleteBlock(id: string): void {
    this.db.prepare('DELETE FROM blocks WHERE id = ?').run(id)
  }
  findBlock(id: string): Block | undefined {
    const row = this.db.prepare('SELECT * FROM blocks WHERE id = ?').get(id) as any
    return row ? { id: row.id, blockerId: row.blockerId, blockedId: row.blockedId, createdAt: Number(row.createdAt) } : undefined
  }
  blocksInvolving(userId: string): Block[] {
    return this.db.prepare('SELECT * FROM blocks WHERE blockerId = ? OR blockedId = ?').all(userId, userId)
      .map((r: any) => ({ id: r.id, blockerId: r.blockerId, blockedId: r.blockedId, createdAt: Number(r.createdAt) }))
  }
  allBlocks(): Block[] {
    return this.db.prepare('SELECT * FROM blocks ORDER BY createdAt DESC').all()
      .map((r: any) => ({ id: r.id, blockerId: r.blockerId, blockedId: r.blockedId, createdAt: Number(r.createdAt) }))
  }

  // MARK: call records
  createCallRecord(rec: CallRecord): void {
    this.db.prepare('INSERT OR REPLACE INTO call_records (id, callId, callerId, calleeId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(rec.id, rec.callId, rec.callerId, rec.calleeId, rec.status, rec.createdAt)
  }
  updateCallStatus(callId: string, calleeId: string, status: CallRecordStatus): void {
    this.db.prepare('UPDATE call_records SET status = ? WHERE callId = ? AND calleeId = ?').run(status, callId, calleeId)
  }
  callRecordsForUser(userId: string, limit = 100): CallRecord[] {
    return this.db.prepare('SELECT * FROM call_records WHERE callerId = ? OR calleeId = ? ORDER BY createdAt DESC LIMIT ?')
      .all(userId, userId, limit)
      .map((r: any) => ({ id: r.id, callId: r.callId, callerId: r.callerId, calleeId: r.calleeId, status: r.status as CallRecordStatus, createdAt: Number(r.createdAt) }))
  }
  allCallRecords(limit = 200): CallRecord[] {
    return this.db.prepare('SELECT * FROM call_records ORDER BY createdAt DESC LIMIT ?')
      .all(limit)
      .map((r: any) => ({ id: r.id, callId: r.callId, callerId: r.callerId, calleeId: r.calleeId, status: r.status as CallRecordStatus, createdAt: Number(r.createdAt) }))
  }

  // MARK: reports
  createReport(r: Report): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO reports (id, reporterId, targetUserId, callId, reason, status, createdAt, decision, resolvedBy, resolvedAt, evidenceRecordingId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(r.id, r.reporterId, r.targetUserId, r.callId ?? null, r.reason, r.status, r.createdAt, r.decision ?? null, r.resolvedBy ?? null, r.resolvedAt ?? null, r.evidenceRecordingId ?? null)
  }
  allReports(): Report[] {
    return this.db.prepare('SELECT * FROM reports').all().map((r) => this.toReport(r))
  }
  findReport(id: string): Report | undefined {
    const row = this.db.prepare('SELECT * FROM reports WHERE id = ?').get(id)
    return row ? this.toReport(row) : undefined
  }
  updateReport(id: string, patch: Partial<Report>): Report | undefined {
    const cur = this.findReport(id)
    if (!cur) return undefined
    const next = { ...cur, ...patch, id: cur.id }
    this.createReport(next)
    return next
  }

  // MARK: recordings + config
  getRecordingConfig(): RecordingConfig {
    const row = this.db.prepare('SELECT v FROM config WHERE k = ?').get('recording') as { v: string } | undefined
    const dflt: RecordingConfig = { enabled: false, retentionDays: 7, requireConsent: true }
    return row ? parseJsonOr<RecordingConfig>(row.v, dflt) : dflt
  }
  setRecordingConfig(patch: Partial<RecordingConfig>): RecordingConfig {
    const next = { ...this.getRecordingConfig(), ...patch }
    this.db.prepare('INSERT OR REPLACE INTO config (k, v) VALUES (?, ?)').run('recording', JSON.stringify(next))
    return next
  }

  // MARK: admin audit / warnings / app config（Admin v3）
  createAuditEntry(e: AdminAuditEntry): void {
    this.db.prepare('INSERT OR REPLACE INTO admin_audit (id, adminId, action, targetType, targetId, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(e.id, e.adminId, e.action, e.targetType, e.targetId, e.detail ?? null, e.at)
  }
  allAuditEntries(limit = 200): AdminAuditEntry[] {
    return this.db.prepare('SELECT * FROM admin_audit ORDER BY at DESC LIMIT ?').all(limit)
      .map((r: any) => ({ id: r.id, adminId: r.adminId, action: r.action, targetType: r.targetType, targetId: r.targetId, detail: r.detail ?? undefined, at: Number(r.at) }))
  }
  createWarning(w: Warning): void {
    this.db.prepare('INSERT OR REPLACE INTO warnings (id, userId, reason, byAdminId, reportId, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(w.id, w.userId, w.reason, w.byAdminId, w.reportId ?? null, w.at)
  }
  warningsForUser(userId: string): Warning[] {
    return this.db.prepare('SELECT * FROM warnings WHERE userId = ? ORDER BY at DESC').all(userId)
      .map((r: any) => ({ id: r.id, userId: r.userId, reason: r.reason, byAdminId: r.byAdminId, reportId: r.reportId ?? undefined, at: Number(r.at) }))
  }
  getAppConfig(): AppConfig {
    const row = this.db.prepare('SELECT v FROM config WHERE k = ?').get('app') as { v: string } | undefined
    return normalizeAppConfig(row ? parseJsonOr<Partial<AppConfig> | null>(row.v, null) : null)
  }
  setAppConfig(patch: AppConfigPatch): AppConfig {
    const next = mergeAppConfig(this.getAppConfig(), patch)
    this.db.prepare('INSERT OR REPLACE INTO config (k, v) VALUES (?, ?)').run('app', JSON.stringify(next))
    return next
  }
  createRecording(rec: Recording): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO recordings (id, callId, ownerId, consentBy, reason, recordedAt, mediaId, participants, durationSec, lat, lon, locationLabel, deletedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      rec.id, rec.callId, rec.ownerId, JSON.stringify(rec.consentBy), rec.reason, rec.recordedAt, rec.mediaId ?? null,
      rec.participants ? JSON.stringify(rec.participants) : null,
      rec.durationSec ?? null, rec.lat ?? null, rec.lon ?? null, rec.locationLabel ?? null, rec.deletedAt ?? null,
    )
  }
  allRecordings(): Recording[] {
    return this.db.prepare('SELECT * FROM recordings').all().map((r) => this.toRecording(r))
  }
  recordingsForUser(ownerId: string): Recording[] {
    return this.db.prepare('SELECT * FROM recordings WHERE ownerId = ? AND deletedAt IS NULL ORDER BY recordedAt DESC')
      .all(ownerId).map((r) => this.toRecording(r))
  }
  findRecording(id: string): Recording | undefined {
    const row = this.db.prepare('SELECT * FROM recordings WHERE id = ?').get(id)
    return row ? this.toRecording(row) : undefined
  }
  recordingByMediaId(mediaId: string): Recording | undefined {
    const row = this.db.prepare('SELECT * FROM recordings WHERE mediaId = ? LIMIT 1').get(mediaId)
    return row ? this.toRecording(row) : undefined
  }
  updateRecording(id: string, patch: Partial<Recording>): Recording | undefined {
    const cur = this.findRecording(id)
    if (!cur) return undefined
    const next = { ...cur, ...patch, id: cur.id }
    this.createRecording(next)
    return next
  }
  reportsCitingRecording(recordingId: string): Report[] {
    return this.db.prepare('SELECT * FROM reports WHERE evidenceRecordingId = ?').all(recordingId).map((r) => this.toReport(r))
  }
  deleteRecording(id: string): void {
    this.db.prepare('DELETE FROM recordings WHERE id = ?').run(id)
  }

  // MARK: 站内通知
  createNotification(n: Notification): void {
    this.db.prepare('INSERT OR REPLACE INTO notifications (id, userId, kind, title, body, dataJson, createdAt, readAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(n.id, n.userId, n.kind, n.title, n.body, n.data ? JSON.stringify(n.data) : null, n.createdAt, n.readAt ?? null)
  }
  notificationsForUser(userId: string, limit = 100): Notification[] {
    return this.db.prepare('SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT ?').all(userId, limit).map((r) => this.toNotification(r))
  }
  findNotification(id: string): Notification | undefined {
    const row = this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(id)
    return row ? this.toNotification(row) : undefined
  }
  markNotificationRead(id: string, userId: string): void {
    this.db.prepare('UPDATE notifications SET readAt = ? WHERE id = ? AND userId = ? AND readAt IS NULL').run(Date.now(), id, userId)
  }
  markAllNotificationsRead(userId: string): number {
    const res = this.db.prepare('UPDATE notifications SET readAt = ? WHERE userId = ? AND readAt IS NULL').run(Date.now(), userId)
    return Number(res.changes ?? 0)
  }
  unreadNotificationCount(userId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND readAt IS NULL').get(userId) as { n: number }
    return Number(row?.n ?? 0)
  }

  // MARK: messages
  createMessage(m: ChatMessage): void {
    this.db.prepare('INSERT OR REPLACE INTO messages (id, fromId, toId, kind, text, createdAt, readAt, reaction, groupId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(m.id, m.fromId, m.toId, m.kind, m.text, m.createdAt, m.readAt ?? null, m.reaction ?? null, m.groupId ?? null)
  }
  findMessage(id: string): ChatMessage | undefined {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id)
    return row ? this.toMessage(row) : undefined
  }
  updateMessage(id: string, patch: Partial<ChatMessage>): ChatMessage | undefined {
    const cur = this.findMessage(id)
    if (!cur) return undefined
    const next = { ...cur, ...patch, id: cur.id }
    this.createMessage(next)
    return next
  }
  messagesBetween(a: string, b: string, limit: number, beforeMs?: number): ChatMessage[] {
    const rows = this.db.prepare(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE groupId IS NULL AND ((fromId = ? AND toId = ?) OR (fromId = ? AND toId = ?)) AND (? IS NULL OR createdAt < ?)
         ORDER BY createdAt DESC LIMIT ?
       ) ORDER BY createdAt ASC`,
    ).all(a, b, b, a, beforeMs ?? null, beforeMs ?? null, limit)
    return rows.map((r) => this.toMessage(r))
  }
  latestMessagesPerPeer(userId: string): ChatMessage[] {
    // 每个对端取最新一条（按对端分组的最大 createdAt）。
    const rows = this.db.prepare(
      `SELECT m.* FROM messages m
       JOIN (
         SELECT CASE WHEN fromId = ? THEN toId ELSE fromId END AS peer, MAX(createdAt) AS latest
         FROM messages WHERE groupId IS NULL AND (fromId = ? OR toId = ?)
         GROUP BY peer
       ) t ON (CASE WHEN m.fromId = ? THEN m.toId ELSE m.fromId END) = t.peer AND m.createdAt = t.latest
       WHERE m.groupId IS NULL AND (m.fromId = ? OR m.toId = ?)
       ORDER BY m.createdAt DESC`,
    ).all(userId, userId, userId, userId, userId, userId)
    return rows.map((r) => this.toMessage(r))
  }
  markMessagesRead(readerId: string, fromId: string, at: number): number {
    const res = this.db.prepare('UPDATE messages SET readAt = ? WHERE toId = ? AND fromId = ? AND readAt IS NULL')
      .run(at, readerId, fromId)
    return Number(res.changes)
  }
  unreadCount(userId: string, fromId: string): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE toId = ? AND fromId = ? AND readAt IS NULL AND groupId IS NULL')
      .get(userId, fromId) as any
    return Number(r?.n ?? 0)
  }
  deleteMessagesForUser(userId: string): void {
    this.db.prepare('DELETE FROM messages WHERE fromId = ? OR toId = ?').run(userId, userId)
  }

  // MARK: 群聊
  createGroup(g: ChatGroup): void {
    this.db.prepare('INSERT OR REPLACE INTO groups (id, name, ownerId, memberIds, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(g.id, g.name, g.ownerId, JSON.stringify(g.memberIds), g.createdAt)
  }
  findGroup(id: string): ChatGroup | undefined {
    const row = this.db.prepare('SELECT * FROM groups WHERE id = ?').get(id)
    return row ? this.toGroup(row) : undefined
  }
  groupsFor(userId: string): ChatGroup[] {
    // memberIds 为 JSON 数组文本：LIKE 粗筛后精确过滤（群数量级小，足够）。
    return this.db.prepare('SELECT * FROM groups WHERE memberIds LIKE ?').all(`%"${userId}"%`)
      .map((r) => this.toGroup(r))
      .filter((g) => g.memberIds.includes(userId))
  }
  updateGroup(id: string, patch: Partial<ChatGroup>): ChatGroup | undefined {
    const cur = this.findGroup(id)
    if (!cur) return undefined
    const next = { ...cur, ...patch, id: cur.id }
    this.createGroup(next)
    return next
  }
  deleteGroup(id: string): void {
    this.db.prepare('DELETE FROM groups WHERE id = ?').run(id)
    this.db.prepare('DELETE FROM messages WHERE groupId = ?').run(id)
    this.db.prepare('DELETE FROM group_reads WHERE groupId = ?').run(id)
  }
  groupMessages(groupId: string, limit: number, beforeMs?: number): ChatMessage[] {
    const rows = this.db.prepare(
      `SELECT * FROM (
         SELECT * FROM messages WHERE groupId = ? AND (? IS NULL OR createdAt < ?)
         ORDER BY createdAt DESC LIMIT ?
       ) ORDER BY createdAt ASC`,
    ).all(groupId, beforeMs ?? null, beforeMs ?? null, limit)
    return rows.map((r) => this.toMessage(r))
  }
  setGroupRead(groupId: string, userId: string, at: number): void {
    this.db.prepare('INSERT OR REPLACE INTO group_reads (groupId, userId, lastReadAt) VALUES (?, ?, ?)')
      .run(groupId, userId, at)
  }
  groupReadAt(groupId: string, userId: string): number {
    const r = this.db.prepare('SELECT lastReadAt FROM group_reads WHERE groupId = ? AND userId = ?')
      .get(groupId, userId) as any
    return r ? Number(r.lastReadAt) : 0
  }

  // MARK: 媒体
  createMedia(m: MediaMeta): void {
    this.db.prepare('INSERT OR REPLACE INTO media (id, ownerId, mime, size, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(m.id, m.ownerId, m.mime, m.size, m.createdAt)
  }
  findMedia(id: string): MediaMeta | undefined {
    const row = this.db.prepare('SELECT * FROM media WHERE id = ?').get(id) as any
    return row ? { id: row.id, ownerId: row.ownerId, mime: row.mime, size: Number(row.size), createdAt: Number(row.createdAt) } : undefined
  }
  deleteMedia(id: string): void {
    this.db.prepare('DELETE FROM media WHERE id = ?').run(id)
  }

  // MARK: row mappers
  private toMessage(r: any): ChatMessage {
    return { id: r.id, fromId: r.fromId, toId: r.toId, kind: (r.kind as ChatMessage['kind']) ?? 'text',
             text: r.text, createdAt: Number(r.createdAt), readAt: r.readAt != null ? Number(r.readAt) : undefined,
             reaction: r.reaction ?? undefined, groupId: r.groupId ?? undefined }
  }
  private toGroup(r: any): ChatGroup {
    let memberIds: string[] = []
    try { memberIds = JSON.parse(r.memberIds) } catch { /* 损坏行视为空成员 */ }
    return { id: r.id, name: r.name, ownerId: r.ownerId, memberIds, createdAt: Number(r.createdAt) }
  }
  private toUser(r: any): User {
    return { id: r.id, username: r.username, passwordHash: r.passwordHash, displayName: r.displayName, role: r.role as Role, status: r.status as UserStatus, createdAt: Number(r.createdAt), language: r.language ?? undefined, tokenVersion: r.tokenVersion != null ? Number(r.tokenVersion) : 0, email: r.email ?? undefined, emailVerified: r.emailVerified != null ? Number(r.emailVerified) === 1 : undefined, voipToken: r.voipToken ?? undefined, avatar: r.avatar ?? undefined, apnsToken: r.apnsToken ?? undefined, phone: r.phone ?? undefined, appleSub: r.appleSub ?? undefined, usernameCustomized: r.usernameCustomized != null ? Number(r.usernameCustomized) === 1 : undefined, legalConsentVersion: r.legalConsentVersion ?? undefined, legalConsentAt: r.legalConsentAt != null ? Number(r.legalConsentAt) : undefined, featureOverrides: parseJsonOrUndefined(r.featureOverrides), totpSecret: r.totpSecret ?? undefined, totpEnabled: r.totpEnabled != null ? Number(r.totpEnabled) === 1 : undefined, totpLastCounter: r.totpLastCounter != null ? Number(r.totpLastCounter) : undefined }
  }
  private toLink(r: any): FamilyLink {
    return { id: r.id, ownerId: r.ownerId, memberId: r.memberId, relation: r.relation, isEmergency: Number(r.isEmergency) === 1, phone: r.phone ?? undefined, createdAt: Number(r.createdAt), status: (r.status as LinkStatus) ?? undefined, requestedBy: r.requestedBy ?? undefined }
  }
  private toReport(r: any): Report {
    return { id: r.id, reporterId: r.reporterId, targetUserId: r.targetUserId, callId: r.callId ?? undefined, reason: r.reason, status: r.status as ReportStatus, createdAt: Number(r.createdAt), decision: r.decision ?? undefined, resolvedBy: r.resolvedBy ?? undefined, resolvedAt: r.resolvedAt != null ? Number(r.resolvedAt) : undefined, evidenceRecordingId: r.evidenceRecordingId ?? undefined }
  }
  private toRecording(r: any): Recording {
    return {
      id: r.id, callId: r.callId, ownerId: r.ownerId, consentBy: parseJsonOr<string[]>(r.consentBy, []),
      reason: r.reason, recordedAt: Number(r.recordedAt), mediaId: r.mediaId ?? undefined,
      participants: parseJsonOrUndefined<string[]>(r.participants),
      durationSec: r.durationSec != null ? Number(r.durationSec) : undefined,
      lat: r.lat != null ? Number(r.lat) : undefined,
      lon: r.lon != null ? Number(r.lon) : undefined,
      locationLabel: r.locationLabel ?? undefined,
      deletedAt: r.deletedAt != null ? Number(r.deletedAt) : undefined,
    }
  }
  private toNotification(r: any): Notification {
    return { id: r.id, userId: r.userId, kind: r.kind, title: r.title, body: r.body, data: parseJsonOrUndefined<Record<string, string>>(r.dataJson), createdAt: Number(r.createdAt), readAt: r.readAt != null ? Number(r.readAt) : undefined }
  }
}
