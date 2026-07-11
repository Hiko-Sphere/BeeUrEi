import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Store, User, Role, EmergencyEvent, WebPushSubscription, UserStatus, FamilyLink, LinkStatus, Block, CallRecord, CallRecordStatus, Report, ReportStatus, Recording, RecordingConfig, RefreshToken, SessionInfo, ChatMessage, ChatGroup, MediaMeta, Passkey, AdminAuditEntry, Warning, AppConfig, AppConfigPatch, Notification, Verification, VerificationStatus, KycBlobRef } from './store'
import { normalizeAppConfig, mergeAppConfig, type SavedRoute, type SavedPlace, type SafetyTimer, type QuietHours, type MedicalInfo, type DailyCheckin } from './store'

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
    // 服务端 SQLite 标准配置（此前零 pragma = rollback journal + synchronous=FULL，每写全量 fsync）：
    // - WAL：写不阻读、崩溃安全等级不降（WAL 本身即崩溃安全）、写路径 fsync 大幅减少；
    //   产生 -wal/-shm 伴生文件（部署卷内，正常）。:memory: 下自动忽略（返回 'memory'），无害。
    // - synchronous=NORMAL：WAL 下的推荐档——断电最坏丢最后一笔已确认事务、库本身绝不损坏
    //   （FULL 在 WAL 下只多防"断电丢最后一笔"，代价是每笔提交都 fsync；消息/通知高频写不值当）。
    // - busy_timeout：外部工具（sqlite3 CLI 检查、备份脚本）并存时等待而非立刻 SQLITE_BUSY。
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec('PRAGMA busy_timeout = 5000')
    // Unicode 感知的小写：SQLite 内置 LOWER() 只折叠 ASCII A-Z，非 ASCII（重音拉丁 CAFÉ/MÜLLER、
    // 西里尔/希腊、全大写拼音等）原样保留，会导致会话内搜索漏掉大写非 ASCII 文本（MemoryStore 用
    // JS toLowerCase 是 Unicode 感知的 → 两存储实现分叉：测试过而线上漏搜）。注册 ulower 镜像 JS
    // toLowerCase，令搜索的文本侧与已 JS 小写的查询侧同口径。deterministic 便于查询优化器缓存。
    this.db.function('ulower', { deterministic: true }, (x) => (x == null ? null : String(x).toLowerCase()))
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
      CREATE TABLE IF NOT EXISTS emergency_events (
        id TEXT PRIMARY KEY, userId TEXT, kind TEXT, lat REAL, lon REAL,
        locSource TEXT, locAgeSec INTEGER, notified INTEGER, contacts INTEGER, at INTEGER);
      CREATE INDEX IF NOT EXISTS idx_emergency_at ON emergency_events(at);
      CREATE TABLE IF NOT EXISTS web_push_subs (
        endpoint TEXT PRIMARY KEY, userId TEXT, p256dh TEXT, auth TEXT, createdAt INTEGER);
      CREATE INDEX IF NOT EXISTS idx_webpush_user ON web_push_subs(userId);
      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY, blockerId TEXT, blockedId TEXT, createdAt INTEGER);
      CREATE TABLE IF NOT EXISTS call_records (
        id TEXT PRIMARY KEY, callId TEXT, callerId TEXT, calleeId TEXT, status TEXT, createdAt INTEGER);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, fromId TEXT, toId TEXT, kind TEXT, text TEXT, createdAt INTEGER, readAt INTEGER, reaction TEXT, groupId TEXT, editedAt INTEGER, replyTo TEXT, forwarded INTEGER);
      CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages (fromId, toId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_messages_to ON messages (toId, readAt);
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY, name TEXT, ownerId TEXT, memberIds TEXT, createdAt INTEGER);
      CREATE TABLE IF NOT EXISTS group_reads (
        groupId TEXT, userId TEXT, lastReadAt INTEGER, PRIMARY KEY (groupId, userId));
      CREATE TABLE IF NOT EXISTS group_mutes (
        groupId TEXT, userId TEXT, PRIMARY KEY (groupId, userId));
      CREATE TABLE IF NOT EXISTS dm_mutes (
        muterId TEXT, peerId TEXT, PRIMARY KEY (muterId, peerId));
      CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY, ownerId TEXT, mime TEXT, size INTEGER, createdAt INTEGER);
      CREATE TABLE IF NOT EXISTS passkeys (
        id TEXT PRIMARY KEY, userId TEXT, credentialId TEXT UNIQUE, publicKey TEXT, counter INTEGER, deviceName TEXT, createdAt INTEGER);
      CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys (userId);
      CREATE TABLE IF NOT EXISTS vision_usage (userId TEXT PRIMARY KEY, day TEXT, count INTEGER);
    `)
    try { this.db.exec('ALTER TABLE emergency_events ADD COLUMN resolvedAt INTEGER') } catch { /* 列已存在 */ } // 报平安解除时刻
    try { this.db.exec('ALTER TABLE emergency_events ADD COLUMN ackedAt INTEGER') } catch { /* 列已存在 */ } // 首个亲友"知道了"时刻（有则不升级重呼）
    try { this.db.exec('ALTER TABLE emergency_events ADD COLUMN escalatedAt INTEGER') } catch { /* 列已存在 */ } // 无人响应升级重呼时刻（只升级一次）
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
    // 登录/查找热路径索引（每次登录都按标识查 users）：username/email 查询带 COLLATE NOCASE，
    // 故索引也须 NOCASE——否则 UNIQUE(username) 的 BINARY 索引用不上、登录退化为全表扫描；
    // phone/appleSub 是迁移列、原本完全无索引。
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_users_username_nocase ON users (username COLLATE NOCASE)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_users_email_nocase ON users (email COLLATE NOCASE)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_users_apple ON users (appleSub)')
    try { this.db.exec('ALTER TABLE users ADD COLUMN usernameCustomized INTEGER') } catch { /* 列已存在 */ } // 是否设过自定义用户名
    try { this.db.exec('ALTER TABLE users ADD COLUMN legalConsentVersion TEXT') } catch { /* 列已存在 */ } // 同意的隐私/条款版本（注册门控+GDPR 可证明同意）
    try { this.db.exec('ALTER TABLE users ADD COLUMN legalConsentAt INTEGER') } catch { /* 列已存在 */ } // 同意时间戳
    try { this.db.exec('ALTER TABLE users ADD COLUMN helperGuidelineAckAt INTEGER') } catch { /* 列已存在 */ } // 协助者守则确认时间
    try { this.db.exec('ALTER TABLE users ADD COLUMN featureOverrides TEXT') } catch { /* 列已存在 */ } // 单用户功能覆盖（JSON）
    try { this.db.exec('ALTER TABLE users ADD COLUMN quietHours TEXT') } catch { /* 列已存在 */ } // 勿扰时段（JSON）
    try { this.db.exec('ALTER TABLE users ADD COLUMN mutedPushCategories TEXT') } catch { /* 列已存在 */ } // 按类别静音的推送横幅（JSON 数组）
    try { this.db.exec('ALTER TABLE users ADD COLUMN callHistorySeenAt INTEGER') } catch { /* 列已存在 */ } // 上次查看通话记录时刻（未接来电角标基线）
    try { this.db.exec('ALTER TABLE users ADD COLUMN readReceiptsEnabled INTEGER') } catch { /* 列已存在 */ } // 读回执开关（NULL=开，仅显式 0 关）
    try { this.db.exec('ALTER TABLE users ADD COLUMN dailyCheckin TEXT') } catch { /* 列已存在 */ } // 每日定时安全报到配置（JSON）
    try { this.db.exec('ALTER TABLE users ADD COLUMN dailyCheckinLastDay TEXT') } catch { /* 列已存在 */ } // 当天已自动开启标记（本地 YYYY-MM-DD）
    try { this.db.exec('ALTER TABLE call_records ADD COLUMN emergency INTEGER') } catch { /* 列已存在 */ } // 紧急求助呼叫标志（通话记录突出未接紧急）
    try { this.db.exec('ALTER TABLE call_records ADD COLUMN durationSec INTEGER') } catch { /* 列已存在 */ } // 通话时长（秒）：接通后由参与方挂断时上报
    try { this.db.exec('ALTER TABLE users ADD COLUMN totpSecret TEXT') } catch { /* 列已存在 */ } // 2FA TOTP base32 密钥（仅服务端校验）
    try { this.db.exec('ALTER TABLE users ADD COLUMN totpEnabled INTEGER') } catch { /* 列已存在 */ } // 2FA 是否已启用
    try { this.db.exec('ALTER TABLE users ADD COLUMN totpLastCounter INTEGER') } catch { /* 列已存在 */ } // TOTP 单次使用防重放
    try { this.db.exec('ALTER TABLE recordings ADD COLUMN mediaId TEXT') } catch { /* 列已存在 */ } // 录制关联的媒体文件
    try { this.db.exec('ALTER TABLE messages ADD COLUMN reaction TEXT') } catch { /* 列已存在 */ } // 表情回应
    try { this.db.exec('ALTER TABLE messages ADD COLUMN groupId TEXT') } catch { /* 列已存在 */ } // 群消息
    try { this.db.exec('ALTER TABLE messages ADD COLUMN editedAt INTEGER') } catch { /* 列已存在 */ } // 消息编辑时刻
    try { this.db.exec('ALTER TABLE messages ADD COLUMN replyTo TEXT') } catch { /* 列已存在 */ } // 引用回复的消息 id
    try { this.db.exec('ALTER TABLE messages ADD COLUMN forwarded INTEGER') } catch { /* 列已存在 */ } // 转发标记
    // 群消息索引必须在 groupId 列迁移之后建——否则旧库（无此列）在 CREATE INDEX 处直接崩。
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_messages_group ON messages (groupId, createdAt)')
    // 热路径索引：授权判定(areLinked/acceptedContactIds)每次都查 links、拉黑检查每次都查 blocks；
    // 通话历史/录制/媒体按参与方/owner 过滤。缺索引则随表增长退化为全表扫描，逐步拖慢**每一个**授权检查。
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_links_owner ON links (ownerId)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_links_member ON links (memberId)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks (blockerId)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blockedId)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_callrec_caller ON call_records (callerId, createdAt)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_callrec_callee ON call_records (calleeId, createdAt)')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS saved_routes (
        id TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        createdBy TEXT NOT NULL,
        name TEXT NOT NULL,
        waypoints TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `)
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_saved_routes_owner ON saved_routes (ownerId, updatedAt)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_saved_routes_creator ON saved_routes (createdBy, updatedAt)')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS saved_places (
        ownerId TEXT NOT NULL,
        label TEXT NOT NULL,
        address TEXT NOT NULL,
        lat REAL,
        lng REAL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (ownerId, label)
      )
    `)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS safety_timers (
        id TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        note TEXT,
        startedAt INTEGER NOT NULL,
        dueAt INTEGER NOT NULL,
        status TEXT NOT NULL,
        firedAt INTEGER,
        completedAt INTEGER,
        canceledAt INTEGER,
        eventId TEXT,
        remindedAt INTEGER
      )
    `)
    try { this.db.exec('ALTER TABLE safety_timers ADD COLUMN remindedAt INTEGER') } catch { /* 列已存在 */ } // 到期前提醒本人时刻（防遗忘误报）
    // 紧急医疗信息（加密信封，1:1 于用户）：sealed 为 JSON.stringify(Sealed) 的密文，DB 只存密文不存明文。
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS medical_info (
        userId TEXT PRIMARY KEY,
        sealed TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `)
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_safety_owner_status ON safety_timers (ownerId, status)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_safety_due ON safety_timers (status, dueAt)') // 后台每分钟扫到期 active
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_recordings_owner ON recordings (ownerId, recordedAt)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_media_owner ON media (ownerId)')
    // recordingByMediaId 在**每次** GET /api/media 都被调（拦截录制媒体外泄），缺索引则每次媒体下载全表扫 recordings。
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_recordings_media ON recordings (mediaId)')
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
    // reportsCitingRecording 在留存清扫里**逐条过期录制**调用（取证保护判定）；缺索引则每条录制全表扫 reports。
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_reports_evidence ON reports (evidenceRecordingId)')
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
    try { this.db.exec('ALTER TABLE refresh_tokens ADD COLUMN rotatedAt INTEGER') } catch { /* 列已存在 */ } // 墓碑：重放检测（见 auth refresh）
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens (userId)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_refresh_session ON refresh_tokens (userId, sessionId)')
    // 实名认证（KYC）：用户布尔徽章 + verifications 表（敏感字段 nameSealed/idNumberSealed/blobs 存 AES-256-GCM 信封 JSON）。
    try { this.db.exec('ALTER TABLE users ADD COLUMN identityVerified INTEGER') } catch { /* 列已存在 */ }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS verifications (
        id TEXT PRIMARY KEY, userId TEXT, status TEXT, idType TEXT, idLast4 TEXT,
        nameSealed TEXT, idNumberSealed TEXT, blobs TEXT,
        submittedVia TEXT, submittedById TEXT, consentToken TEXT, consentVersion TEXT,
        legalHold INTEGER, submittedAt INTEGER, decidedBy TEXT, decidedAt INTEGER,
        rejectReasonCode TEXT, rejectReasonNote TEXT, attempt INTEGER);
      CREATE INDEX IF NOT EXISTS idx_verif_user ON verifications (userId, submittedAt);
      CREATE INDEX IF NOT EXISTS idx_verif_status ON verifications (status, submittedAt);
    `)
    // 一人一活跃记录（pending|verified）的数据库兜底——与应用层守卫双保险，防并发双提交。
    try {
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_verif_active
        ON verifications (userId) WHERE status IN ('pending','verified')`)
    } catch { /* 已存在 */ }
  }

  // MARK: refresh tokens
  createRefreshToken(rt: RefreshToken): void {
    this.db.prepare('INSERT OR REPLACE INTO refresh_tokens (tokenHash, userId, expiresAt, sessionId, deviceLabel, createdAt, lastSeenAt, rotatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(rt.tokenHash, rt.userId, rt.expiresAt, rt.sessionId ?? null, rt.deviceLabel ?? null, rt.createdAt ?? null, rt.lastSeenAt ?? null, rt.rotatedAt ?? null)
  }
  findRefreshToken(tokenHash: string): RefreshToken | undefined {
    const row = this.db.prepare('SELECT * FROM refresh_tokens WHERE tokenHash = ?').get(tokenHash) as any
    return row ? { tokenHash: row.tokenHash, userId: row.userId, expiresAt: Number(row.expiresAt), sessionId: row.sessionId ?? undefined, deviceLabel: row.deviceLabel ?? undefined, createdAt: row.createdAt != null ? Number(row.createdAt) : undefined, lastSeenAt: row.lastSeenAt != null ? Number(row.lastSeenAt) : undefined, rotatedAt: row.rotatedAt != null ? Number(row.rotatedAt) : undefined } : undefined
  }
  deleteRefreshToken(tokenHash: string): void {
    this.db.prepare('DELETE FROM refresh_tokens WHERE tokenHash = ?').run(tokenHash)
  }
  markRefreshTokenRotated(tokenHash: string, at: number): void {
    this.db.prepare('UPDATE refresh_tokens SET rotatedAt = ? WHERE tokenHash = ?').run(at, tokenHash)
  }
  deleteExpiredRefreshTokens(nowMs: number): number {
    return Number(this.db.prepare('DELETE FROM refresh_tokens WHERE expiresAt <= ?').run(nowMs).changes)
  }
  deleteRefreshTokensForUser(userId: string): void {
    this.db.prepare('DELETE FROM refresh_tokens WHERE userId = ?').run(userId)
  }
  countSessionsForUser(userId: string, nowMs: number): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE userId = ? AND expiresAt > ? AND rotatedAt IS NULL').get(userId, nowMs) as { n: number }
    return Number(row.n)
  }
  sessionsForUser(userId: string, nowMs: number): SessionInfo[] {
    const rows = this.db.prepare(
      `SELECT sessionId, MAX(deviceLabel) AS deviceLabel, MIN(createdAt) AS createdAt, MAX(lastSeenAt) AS lastSeenAt, MAX(expiresAt) AS expiresAt
       FROM refresh_tokens WHERE userId = ? AND expiresAt > ? AND rotatedAt IS NULL AND sessionId IS NOT NULL
       GROUP BY sessionId ORDER BY lastSeenAt DESC`,
    ).all(userId, nowMs) as any[]
    return rows.map((r) => ({ sessionId: r.sessionId, deviceLabel: r.deviceLabel ?? undefined, createdAt: r.createdAt != null ? Number(r.createdAt) : undefined, lastSeenAt: r.lastSeenAt != null ? Number(r.lastSeenAt) : undefined, expiresAt: Number(r.expiresAt) }))
  }
  hasActiveSession(userId: string, sessionId: string, nowMs: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM refresh_tokens WHERE userId = ? AND sessionId = ? AND expiresAt > ? AND rotatedAt IS NULL LIMIT 1').get(userId, sessionId, nowMs)
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
    // 插入型（updatePasskeyCounter 走独立 UPDATE，不复用本方法）：用**普通 INSERT** 而非 INSERT OR REPLACE——
    // 后者会把 credentialId UNIQUE 冲突"解决"成删掉他人已有 passkey（静默删除免密凭据的地雷）。普通 INSERT 遇冲突
    // 直接抛（等同 UNIQUE 本意，与 MemoryStore 同口径）；注册入口已先 findPasskeyByCredentialId→409 且同步原子，触不到，此为从严兜底。
    this.db.prepare('INSERT INTO passkeys (id, userId, credentialId, publicKey, counter, deviceName, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
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
    // 防"同名夺舍"：createUser 用 INSERT OR REPLACE（updateUser 复用它按 id 覆盖所需），但它会把 username UNIQUE
    // 冲突"解决"成**删掉既有他人账号**——与 UNIQUE(username) 的本意（拒绝重名）截然相反、是静默删号/接管的地雷。
    // 现有入口(注册/改名)都先 findByUsername 校验且同步原子，触不到；此处从严兜底：username 若属**另一个 id** 即抛
    // （等同真 UNIQUE 约束、且与 MemoryStore 同口径），宁可响亮 500 也绝不静默抹掉一个账号。同 id（updateUser）放行。
    const clash = this.db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(u.username) as { id: string } | undefined
    if (clash && clash.id !== u.id) throw new Error('username_taken')
    this.db.prepare(
      `INSERT OR REPLACE INTO users (id, username, passwordHash, displayName, role, status, createdAt, language, tokenVersion, email, emailVerified, voipToken, avatar, apnsToken, phone, appleSub, usernameCustomized, legalConsentVersion, legalConsentAt, helperGuidelineAckAt, featureOverrides, totpSecret, totpEnabled, totpLastCounter, identityVerified, quietHours, mutedPushCategories, callHistorySeenAt, readReceiptsEnabled, dailyCheckin, dailyCheckinLastDay)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(u.id, u.username, u.passwordHash, u.displayName, u.role, u.status, u.createdAt, u.language ?? null, u.tokenVersion ?? 0, u.email ?? null, u.emailVerified ? 1 : 0, u.voipToken ?? null, u.avatar ?? null, u.apnsToken ?? null, u.phone ?? null, u.appleSub ?? null, u.usernameCustomized ? 1 : 0, u.legalConsentVersion ?? null, u.legalConsentAt ?? null, u.helperGuidelineAckAt ?? null, u.featureOverrides ? JSON.stringify(u.featureOverrides) : null, u.totpSecret ?? null, u.totpEnabled ? 1 : 0, u.totpLastCounter ?? null, u.identityVerified ? 1 : 0, u.quietHours ? JSON.stringify(u.quietHours) : null, u.mutedPushCategories && u.mutedPushCategories.length ? JSON.stringify(u.mutedPushCategories) : null, u.callHistorySeenAt ?? null, u.readReceiptsEnabled == null ? null : (u.readReceiptsEnabled ? 1 : 0), u.dailyCheckin ? JSON.stringify(u.dailyCheckin) : null, u.dailyCheckinLastDay ?? null)
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
  /// 一致性快照备份：VACUUM INTO 在线执行、不锁写、产物为紧凑的独立 .db 文件。
  /// destPath 由服务端自生成（tmp+uuid，非用户输入）；单引号转义仅为纵深防御（VACUUM INTO 不支持绑定参数）。
  backupTo(destPath: string): void {
    this.db.exec(`VACUUM INTO '${destPath.replaceAll("'", "''")}'`)
  }

  userCount(): number { return (this.db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c }
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
  clearApnsTokenFromOthers(token: string, exceptUserId: string): void {
    this.db.prepare('UPDATE users SET apnsToken = NULL WHERE apnsToken = ? AND id != ?').run(token, exceptUserId)
  }
  clearVoipTokenFromOthers(token: string, exceptUserId: string): void {
    this.db.prepare('UPDATE users SET voipToken = NULL WHERE voipToken = ? AND id != ?').run(token, exceptUserId)
  }
  clearPushToken(token: string): void {
    this.db.prepare('UPDATE users SET apnsToken = NULL WHERE apnsToken = ?').run(token)
    this.db.prepare('UPDATE users SET voipToken = NULL WHERE voipToken = ?').run(token)
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
    this.db.prepare('INSERT OR REPLACE INTO call_records (id, callId, callerId, calleeId, status, createdAt, emergency, durationSec) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(rec.id, rec.callId, rec.callerId, rec.calleeId, rec.status, rec.createdAt, rec.emergency ? 1 : 0, rec.durationSec ?? null)
  }
  updateCallStatus(callId: string, calleeId: string, status: CallRecordStatus): void {
    this.db.prepare('UPDATE call_records SET status = ? WHERE callId = ? AND calleeId = ?').run(status, callId, calleeId)
  }
  setCallDuration(callId: string, participantId: string, seconds: number): void {
    // 只更新该 callId 下 participant 参与（主叫或被叫）的记录——两侧一致。
    this.db.prepare('UPDATE call_records SET durationSec = ? WHERE callId = ? AND (callerId = ? OR calleeId = ?)').run(seconds, callId, participantId, participantId)
  }
  callRecordsForUser(userId: string, limit = 100): CallRecord[] {
    return this.db.prepare('SELECT * FROM call_records WHERE callerId = ? OR calleeId = ? ORDER BY createdAt DESC LIMIT ?')
      .all(userId, userId, limit)
      .map((r: any) => ({ id: r.id, callId: r.callId, callerId: r.callerId, calleeId: r.calleeId, status: r.status as CallRecordStatus, createdAt: Number(r.createdAt), emergency: r.emergency === 1, durationSec: r.durationSec != null ? Number(r.durationSec) : undefined }))
  }
  missedCallCountForUser(userId: string, sinceMs: number): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM call_records WHERE calleeId = ? AND status = 'missed' AND createdAt > ?").get(userId, sinceMs) as { n: number }
    return Number(row.n)
  }
  deleteCallRecordsOlderThan(cutoffMs: number): number {
    return Number(this.db.prepare('DELETE FROM call_records WHERE createdAt < ?').run(cutoffMs).changes)
  }
  deleteCallRecordsForUser(userId: string): void {
    this.db.prepare('DELETE FROM call_records WHERE callerId = ? OR calleeId = ?').run(userId, userId)
  }
  allCallRecords(limit = 200): CallRecord[] {
    return this.db.prepare('SELECT * FROM call_records ORDER BY createdAt DESC LIMIT ?')
      .all(limit)
      // durationSec 与 callRecordsForUser 同样映射：此前漏读 → 生产(SqliteStore)下管理端「全站通话」视图 + CSV
      // 导出的时长恒为 null(即便已接通有时长)，而 MemoryStore(测试)返回整对象含时长 → 测试盲区(见平价审计)。
      .map((r: any) => ({ id: r.id, callId: r.callId, callerId: r.callerId, calleeId: r.calleeId, status: r.status as CallRecordStatus, createdAt: Number(r.createdAt), emergency: r.emergency === 1, durationSec: r.durationSec != null ? Number(r.durationSec) : undefined }))
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
  private rowToSavedRoute(r: any): SavedRoute {
    return { id: r.id, ownerId: r.ownerId, createdBy: r.createdBy, name: r.name,
             waypoints: JSON.parse(r.waypoints), createdAt: Number(r.createdAt), updatedAt: Number(r.updatedAt) }
  }
  createSavedRoute(route: SavedRoute): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO saved_routes (id, ownerId, createdBy, name, waypoints, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(route.id, route.ownerId, route.createdBy, route.name, JSON.stringify(route.waypoints), route.createdAt, route.updatedAt)
  }
  savedRoutesForUser(ownerId: string): SavedRoute[] {
    return (this.db.prepare('SELECT * FROM saved_routes WHERE ownerId = ? ORDER BY updatedAt DESC').all(ownerId) as any[]).map((r) => this.rowToSavedRoute(r))
  }
  savedRoutesByCreator(creatorId: string): SavedRoute[] {
    return (this.db.prepare('SELECT * FROM saved_routes WHERE createdBy = ? ORDER BY updatedAt DESC').all(creatorId) as any[]).map((r) => this.rowToSavedRoute(r))
  }
  findSavedRoute(id: string): SavedRoute | undefined {
    const r = this.db.prepare('SELECT * FROM saved_routes WHERE id = ?').get(id) as any
    return r ? this.rowToSavedRoute(r) : undefined
  }
  updateSavedRoute(id: string, patch: Partial<SavedRoute>): SavedRoute | undefined {
    const cur = this.findSavedRoute(id)
    if (!cur) return undefined
    const next = { ...cur, ...patch, id: cur.id, ownerId: cur.ownerId, createdBy: cur.createdBy } // 归属/绘制者不可改
    this.createSavedRoute(next) // INSERT OR REPLACE 全列覆盖（read-merge-write，与其余 update 同式）
    return next
  }
  deleteSavedRoute(id: string): void {
    this.db.prepare('DELETE FROM saved_routes WHERE id = ?').run(id)
  }
  deleteSavedRoutesForOwner(ownerId: string): void {
    this.db.prepare('DELETE FROM saved_routes WHERE ownerId = ?').run(ownerId)
  }
  private rowToSavedPlace(r: any): SavedPlace {
    return {
      ownerId: r.ownerId, label: r.label, address: r.address,
      lat: r.lat != null ? Number(r.lat) : undefined, // NULL → undefined（未 geocode 出坐标）
      lng: r.lng != null ? Number(r.lng) : undefined,
      updatedAt: Number(r.updatedAt),
    }
  }
  savedPlacesForUser(ownerId: string): SavedPlace[] {
    return (this.db.prepare('SELECT * FROM saved_places WHERE ownerId = ? ORDER BY updatedAt DESC').all(ownerId) as any[]).map((r) => this.rowToSavedPlace(r))
  }
  upsertSavedPlace(p: SavedPlace): void {
    this.db.prepare('INSERT OR REPLACE INTO saved_places (ownerId, label, address, lat, lng, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(p.ownerId, p.label, p.address, p.lat ?? null, p.lng ?? null, p.updatedAt) // 复合主键 (ownerId,label)：同 label 覆盖
  }
  deleteSavedPlace(ownerId: string, label: string): void {
    this.db.prepare('DELETE FROM saved_places WHERE ownerId = ? AND label = ?').run(ownerId, label)
  }
  deleteSavedPlacesForOwner(ownerId: string): void {
    this.db.prepare('DELETE FROM saved_places WHERE ownerId = ?').run(ownerId)
  }

  private static mapSafetyRow(r: any): SafetyTimer {
    return { id: r.id, ownerId: r.ownerId, note: r.note ?? undefined,
      startedAt: Number(r.startedAt), dueAt: Number(r.dueAt), status: r.status,
      firedAt: r.firedAt != null ? Number(r.firedAt) : undefined,
      completedAt: r.completedAt != null ? Number(r.completedAt) : undefined,
      canceledAt: r.canceledAt != null ? Number(r.canceledAt) : undefined,
      eventId: r.eventId ?? undefined,
      remindedAt: r.remindedAt != null ? Number(r.remindedAt) : undefined }
  }
  private writeSafetyTimer(t: SafetyTimer): void {
    this.db.prepare('INSERT OR REPLACE INTO safety_timers (id, ownerId, note, startedAt, dueAt, status, firedAt, completedAt, canceledAt, eventId, remindedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(t.id, t.ownerId, t.note ?? null, t.startedAt, t.dueAt, t.status, t.firedAt ?? null, t.completedAt ?? null, t.canceledAt ?? null, t.eventId ?? null, t.remindedAt ?? null)
  }
  createSafetyTimer(t: SafetyTimer): void { this.writeSafetyTimer(t) }
  getSafetyTimer(id: string): SafetyTimer | undefined {
    const r = this.db.prepare('SELECT * FROM safety_timers WHERE id = ?').get(id) as any
    return r ? SqliteStore.mapSafetyRow(r) : undefined
  }
  updateSafetyTimer(id: string, patch: Partial<SafetyTimer>): void {
    const cur = this.getSafetyTimer(id) // 读-合并-写：避免动态 SQL，与其它实体 upsert 口径一致
    if (!cur) return
    this.writeSafetyTimer({ ...cur, ...patch })
  }
  activeSafetyTimerForOwner(ownerId: string): SafetyTimer | undefined {
    const r = this.db.prepare("SELECT * FROM safety_timers WHERE ownerId = ? AND status = 'active' ORDER BY startedAt DESC LIMIT 1").get(ownerId) as any
    return r ? SqliteStore.mapSafetyRow(r) : undefined
  }
  safetyTimersForUser(ownerId: string): SafetyTimer[] {
    return (this.db.prepare('SELECT * FROM safety_timers WHERE ownerId = ? ORDER BY startedAt DESC').all(ownerId) as any[]).map(SqliteStore.mapSafetyRow)
  }
  expiredActiveSafetyTimers(now: number): SafetyTimer[] {
    return (this.db.prepare("SELECT * FROM safety_timers WHERE status = 'active' AND dueAt <= ? ORDER BY dueAt ASC").all(now) as any[]).map(SqliteStore.mapSafetyRow)
  }
  dueSoonUnremindedSafetyTimers(now: number, leadMs: number): SafetyTimer[] {
    // active ∧ 未提醒 ∧ 总时长>leadMs（短计时器不提前提醒） ∧ 进入 [dueAt-leadMs, dueAt) 窗口（未到期）。
    return (this.db.prepare(
      "SELECT * FROM safety_timers WHERE status = 'active' AND remindedAt IS NULL AND (dueAt - startedAt) > ? AND ? >= (dueAt - ?) AND ? < dueAt ORDER BY dueAt ASC")
      .all(leadMs, now, leadMs, now) as any[]).map(SqliteStore.mapSafetyRow)
  }
  deleteSafetyTimersForOwner(ownerId: string): void {
    this.db.prepare('DELETE FROM safety_timers WHERE ownerId = ?').run(ownerId)
  }
  deleteSafetyTimersOlderThan(cutoffMs: number): number {
    // 只清终态：active 无论多老都保留（免误删待触发的报到）。
    return Number(this.db.prepare("DELETE FROM safety_timers WHERE status != 'active' AND startedAt < ?").run(cutoffMs).changes)
  }

  getMedicalInfo(userId: string): MedicalInfo | undefined {
    const r = this.db.prepare('SELECT userId, sealed, updatedAt FROM medical_info WHERE userId = ?').get(userId) as any
    return r ? { userId: r.userId, sealed: r.sealed, updatedAt: Number(r.updatedAt) } : undefined
  }
  setMedicalInfo(m: MedicalInfo): void {
    this.db.prepare('INSERT OR REPLACE INTO medical_info (userId, sealed, updatedAt) VALUES (?, ?, ?)').run(m.userId, m.sealed, m.updatedAt)
  }
  deleteMedicalInfoForUser(userId: string): void {
    this.db.prepare('DELETE FROM medical_info WHERE userId = ?').run(userId)
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
  // MARK: verifications (KYC)
  createVerification(v: Verification): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO verifications (id, userId, status, idType, idLast4, nameSealed, idNumberSealed, blobs, submittedVia, submittedById, consentToken, consentVersion, legalHold, submittedAt, decidedBy, decidedAt, rejectReasonCode, rejectReasonNote, attempt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      v.id, v.userId, v.status, v.idType, v.idLast4 ?? null,
      v.nameSealed ? JSON.stringify(v.nameSealed) : null,
      v.idNumberSealed ? JSON.stringify(v.idNumberSealed) : null,
      v.blobs ? JSON.stringify(v.blobs) : null,
      v.submittedVia, v.submittedById, v.consentToken ?? null, v.consentVersion ?? null,
      v.legalHold ? 1 : 0, v.submittedAt, v.decidedBy ?? null, v.decidedAt ?? null,
      v.rejectReasonCode ?? null, v.rejectReasonNote ?? null, v.attempt,
    )
  }
  getActiveVerificationForUser(userId: string): Verification | undefined {
    const row = this.db.prepare(
      "SELECT * FROM verifications WHERE userId = ? AND status IN ('pending','verified') ORDER BY submittedAt DESC LIMIT 1",
    ).get(userId)
    return row ? this.toVerification(row) : undefined
  }
  latestVerificationForUser(userId: string): Verification | undefined {
    const row = this.db.prepare('SELECT * FROM verifications WHERE userId = ? ORDER BY submittedAt DESC LIMIT 1').get(userId)
    return row ? this.toVerification(row) : undefined
  }
  findVerification(id: string): Verification | undefined {
    const row = this.db.prepare('SELECT * FROM verifications WHERE id = ?').get(id)
    return row ? this.toVerification(row) : undefined
  }
  listVerifications(status?: VerificationStatus, limit?: number): Verification[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM verifications WHERE status = ? ORDER BY submittedAt DESC' + (limit != null ? ' LIMIT ?' : '')).all(...(limit != null ? [status, limit] : [status]))
      : this.db.prepare('SELECT * FROM verifications ORDER BY submittedAt DESC' + (limit != null ? ' LIMIT ?' : '')).all(...(limit != null ? [limit] : []))
    return rows.map((r) => this.toVerification(r))
  }
  updateVerification(id: string, patch: Partial<Verification>): Verification | undefined {
    const cur = this.findVerification(id)
    if (!cur) return undefined
    const next = { ...cur, ...patch, id: cur.id }
    this.createVerification(next)
    return next
  }
  decideVerification(id: string, patch: Partial<Verification>): Verification | undefined {
    // 条件更新：仅当当前仍为 pending 才落更。WHERE status='pending' 让两位管理员竞态时恰好一人 changes===1。
    const cur = this.findVerification(id)
    if (!cur || cur.status !== 'pending') return undefined
    const next = { ...cur, ...patch, id: cur.id }
    const info = this.db.prepare(
      `UPDATE verifications SET status=?, nameSealed=?, idNumberSealed=?, blobs=?, legalHold=?, decidedBy=?, decidedAt=?, rejectReasonCode=?, rejectReasonNote=?
       WHERE id=? AND status='pending'`,
    ).run(
      next.status,
      next.nameSealed ? JSON.stringify(next.nameSealed) : null,
      next.idNumberSealed ? JSON.stringify(next.idNumberSealed) : null,
      next.blobs ? JSON.stringify(next.blobs) : null,
      next.legalHold ? 1 : 0,
      next.decidedBy ?? null, next.decidedAt ?? null,
      next.rejectReasonCode ?? null, next.rejectReasonNote ?? null, id,
    )
    return Number(info.changes) === 1 ? next : undefined
  }
  countPendingVerifications(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM verifications WHERE status = 'pending'").get() as { n: number }
    return Number(row.n)
  }
  allVerifications(): Verification[] {
    return this.db.prepare('SELECT * FROM verifications').all().map((r) => this.toVerification(r))
  }
  deleteVerificationsForUser(userId: string): void {
    // 法务保留(legalHold)的记录刻意保留为取证证据（与级联删号保留 举报/警告 同理）；其余删除。
    this.db.prepare('DELETE FROM verifications WHERE userId = ? AND (legalHold IS NULL OR legalHold = 0)').run(userId)
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
  deleteNotification(id: string, userId: string): boolean {
    // 仅本人：WHERE 同时限 id + userId，非本人的删除影响 0 行 → false（不泄露他人通知存在性）。
    return Number(this.db.prepare('DELETE FROM notifications WHERE id = ? AND userId = ?').run(id, userId).changes) > 0
  }
  deleteReadNotificationsForUser(userId: string): number {
    return Number(this.db.prepare('DELETE FROM notifications WHERE userId = ? AND readAt IS NOT NULL').run(userId).changes)
  }
  deleteNotificationsForUser(userId: string): void {
    this.db.prepare('DELETE FROM notifications WHERE userId = ?').run(userId)
  }
  deleteNotificationsOlderThan(cutoffMs: number): number {
    return Number(this.db.prepare('DELETE FROM notifications WHERE createdAt < ?').run(cutoffMs).changes)
  }
  createEmergencyEvent(e: EmergencyEvent): void {
    this.db.prepare('INSERT OR REPLACE INTO emergency_events (id, userId, kind, lat, lon, locSource, locAgeSec, notified, contacts, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(e.id, e.userId, e.kind, e.lat ?? null, e.lon ?? null, e.locSource ?? null, e.locAgeSec ?? null, e.notified, e.contacts, e.at)
  }
  private static mapEmergencyRow(r: any): EmergencyEvent {
    return { id: r.id, userId: r.userId, kind: r.kind,
      lat: r.lat != null ? Number(r.lat) : undefined, lon: r.lon != null ? Number(r.lon) : undefined,
      locSource: r.locSource ?? undefined, locAgeSec: r.locAgeSec != null ? Number(r.locAgeSec) : undefined,
      notified: Number(r.notified), contacts: Number(r.contacts), at: Number(r.at),
      resolvedAt: r.resolvedAt != null ? Number(r.resolvedAt) : undefined,
      ackedAt: r.ackedAt != null ? Number(r.ackedAt) : undefined,
      escalatedAt: r.escalatedAt != null ? Number(r.escalatedAt) : undefined }
  }
  recentEmergencyEvents(limit = 100): EmergencyEvent[] {
    return (this.db.prepare('SELECT * FROM emergency_events ORDER BY at DESC LIMIT ?').all(Math.max(0, limit)) as any[]).map(SqliteStore.mapEmergencyRow)
  }
  emergencyEventsForUser(userId: string): EmergencyEvent[] {
    return (this.db.prepare('SELECT * FROM emergency_events WHERE userId = ? ORDER BY at DESC').all(userId) as any[]).map(SqliteStore.mapEmergencyRow)
  }
  resolveOpenEmergencyEvents(userId: string, now: number): number {
    // 报平安=本人已安全 → 该用户**全部**未解除事件一并解除（否则遗留的旧事件会被升级重呼误报，见 MemoryStore 注释）。
    const info = this.db.prepare(
      'UPDATE emergency_events SET resolvedAt = ? WHERE userId = ? AND resolvedAt IS NULL',
    ).run(now, userId)
    return Number(info.changes)
  }
  markEmergencyAcked(eventId: string, at: number): void {
    // 只在首个确认时落 ackedAt（后续确认者不覆盖首次时刻）。
    this.db.prepare('UPDATE emergency_events SET ackedAt = ? WHERE id = ? AND ackedAt IS NULL').run(at, eventId)
  }
  markEmergencyEscalated(eventId: string, at: number): void {
    this.db.prepare('UPDATE emergency_events SET escalatedAt = ? WHERE id = ?').run(at, eventId)
  }
  unacknowledgedEmergencyEvents(olderThanAt: number, now: number): EmergencyEvent[] {
    // 升级候选：未报平安 ∧ 无亲友确认 ∧ 未升级过 ∧ 已发出满阈值时长。不设过老下限——由留存清扫另行删旧。
    return (this.db.prepare(
      `SELECT * FROM emergency_events
       WHERE resolvedAt IS NULL AND ackedAt IS NULL AND escalatedAt IS NULL AND at <= ?
       ORDER BY at ASC`,
    ).all(olderThanAt) as any[]).map(SqliteStore.mapEmergencyRow)
  }
  deleteEmergencyEventsForUser(userId: string): void {
    this.db.prepare('DELETE FROM emergency_events WHERE userId = ?').run(userId)
  }
  deleteEmergencyEventsOlderThan(cutoffMs: number): number {
    return Number(this.db.prepare('DELETE FROM emergency_events WHERE at < ?').run(cutoffMs).changes)
  }
  upsertWebPushSubscription(sub: WebPushSubscription): void {
    this.db.prepare('INSERT OR REPLACE INTO web_push_subs (endpoint, userId, p256dh, auth, createdAt) VALUES (?, ?, ?, ?, ?)')
      .run(sub.endpoint, sub.userId, sub.p256dh, sub.auth, sub.createdAt)
  }
  webPushSubscriptionsForUser(userId: string): WebPushSubscription[] {
    const rows = this.db.prepare('SELECT * FROM web_push_subs WHERE userId = ?').all(userId) as any[]
    return rows.map((r) => ({ endpoint: r.endpoint, userId: r.userId, p256dh: r.p256dh, auth: r.auth, createdAt: Number(r.createdAt) }))
  }
  findWebPushSubscription(endpoint: string): WebPushSubscription | undefined {
    const r = this.db.prepare('SELECT * FROM web_push_subs WHERE endpoint = ?').get(endpoint) as any
    return r ? { endpoint: r.endpoint, userId: r.userId, p256dh: r.p256dh, auth: r.auth, createdAt: Number(r.createdAt) } : undefined
  }
  deleteWebPushSubscription(endpoint: string): void {
    this.db.prepare('DELETE FROM web_push_subs WHERE endpoint = ?').run(endpoint)
  }
  deleteWebPushSubscriptionsForUser(userId: string): void {
    this.db.prepare('DELETE FROM web_push_subs WHERE userId = ?').run(userId)
  }
  clearWebPushSubscriptionFromOthers(endpoint: string, exceptUserId: string): void {
    this.db.prepare('DELETE FROM web_push_subs WHERE endpoint = ? AND userId != ?').run(endpoint, exceptUserId)
  }

  // MARK: messages
  createMessage(m: ChatMessage): void {
    this.db.prepare('INSERT OR REPLACE INTO messages (id, fromId, toId, kind, text, createdAt, readAt, reaction, groupId, editedAt, replyTo, forwarded) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(m.id, m.fromId, m.toId, m.kind, m.text, m.createdAt, m.readAt ?? null, m.reaction ?? null, m.groupId ?? null, m.editedAt ?? null, m.replyTo ?? null, m.forwarded ? 1 : null)
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
  messagesBetween(a: string, b: string, limit: number, beforeMs?: number, beforeId?: string): ChatMessage[] {
    const bm = beforeMs ?? null, bi = beforeId ?? null
    const rows = this.db.prepare(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE groupId IS NULL AND ((fromId = ? AND toId = ?) OR (fromId = ? AND toId = ?))
           AND (? IS NULL OR createdAt < ? OR (? IS NOT NULL AND createdAt = ? AND id < ?))
         ORDER BY createdAt DESC, id DESC LIMIT ?
       ) ORDER BY createdAt ASC, id ASC`,
    ).all(a, b, b, a, bm, bm, bi, bm, bi, limit)
    return rows.map((r) => this.toMessage(r))
  }
  latestMessagesPerPeer(userId: string): ChatMessage[] {
    // 每个对端取 (createdAt,id) 最大的**唯一**一条。用 ROW_NUMBER 而非 MAX(createdAt) JOIN：
    // 否则同对端两条同毫秒消息会双双命中 MAX，导致该对端在会话列表里重复出现（见与 MemoryStore 对齐）。
    const rows = this.db.prepare(
      `SELECT * FROM (
         SELECT m.*, ROW_NUMBER() OVER (
           PARTITION BY (CASE WHEN m.fromId = ? THEN m.toId ELSE m.fromId END)
           ORDER BY m.createdAt DESC, m.id DESC
         ) AS rn
         FROM messages m WHERE m.groupId IS NULL AND (m.fromId = ? OR m.toId = ?)
       ) WHERE rn = 1
       ORDER BY createdAt DESC, id DESC`,
    ).all(userId, userId, userId)
    return rows.map((r) => this.toMessage(r))
  }
  markMessagesRead(readerId: string, fromId: string, at: number): number {
    const res = this.db.prepare('UPDATE messages SET readAt = ? WHERE toId = ? AND fromId = ? AND readAt IS NULL')
      .run(at, readerId, fromId)
    return Number(res.changes)
  }
  unreadCount(userId: string, fromId: string): number {
    // 排除已撤回（kind=recalled）：撤回消息无内容可读，不应计未读（与群未读口径一致）。
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE toId = ? AND fromId = ? AND readAt IS NULL AND groupId IS NULL AND kind != 'recalled'")
      .get(userId, fromId) as any
    return Number(r?.n ?? 0)
  }
  unreadGroupCount(groupId: string, userId: string): number {
    // 无上限 COUNT：比"取最近 200 条消息体再 filter"既准（>200 未读不漏计）又省（只数不载列/不建对象）。
    const readAt = this.groupReadAt(groupId, userId)
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE groupId = ? AND createdAt > ? AND fromId != ? AND kind != 'recalled'")
      .get(groupId, readAt, userId) as any
    return Number(r?.n ?? 0)
  }
  deleteMessagesForUser(userId: string): void {
    this.db.prepare('DELETE FROM messages WHERE fromId = ? OR toId = ?').run(userId, userId)
  }
  messagesSentBy(userId: string, limit: number): ChatMessage[] {
    const rows = this.db.prepare('SELECT * FROM messages WHERE fromId = ? ORDER BY createdAt ASC, id ASC LIMIT ?').all(userId, Math.max(0, limit)) as any[]
    return rows.map((r) => this.toMessage(r))
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
    this.db.prepare('DELETE FROM group_mutes WHERE groupId = ?').run(id)
  }
  groupMessages(groupId: string, limit: number, beforeMs?: number, beforeId?: string): ChatMessage[] {
    const bm = beforeMs ?? null, bi = beforeId ?? null
    const rows = this.db.prepare(
      `SELECT * FROM (
         SELECT * FROM messages WHERE groupId = ?
           AND (? IS NULL OR createdAt < ? OR (? IS NOT NULL AND createdAt = ? AND id < ?))
         ORDER BY createdAt DESC, id DESC LIMIT ?
       ) ORDER BY createdAt ASC, id ASC`,
    ).all(groupId, bm, bm, bi, bm, bi, limit)
    return rows.map((r) => this.toMessage(r))
  }
  lastGroupMessage(groupId: string): ChatMessage | undefined {
    // 只取 1 行（同 groupMessages 的末尾：createdAt/id 最大），避免为拿"最后一条"取 200 行。
    const r = this.db.prepare('SELECT * FROM messages WHERE groupId = ? ORDER BY createdAt DESC, id DESC LIMIT 1').get(groupId) as any
    return r ? this.toMessage(r) : undefined
  }
  searchDirectMessages(a: string, b: string, query: string, limit: number): ChatMessage[] {
    const q = query.trim().toLowerCase()
    if (q === '') return []
    const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%' // 转义 LIKE 通配符，按字面量匹配
    const rows = this.db.prepare(
      `SELECT * FROM messages
       WHERE groupId IS NULL AND kind = 'text'
         AND ((fromId = ? AND toId = ?) OR (fromId = ? AND toId = ?))
         AND ulower(text) LIKE ? ESCAPE '\\'
       ORDER BY createdAt DESC, id DESC LIMIT ?`,
    ).all(a, b, b, a, like, limit)
    return rows.map((r) => this.toMessage(r))
  }
  searchGroupMessages(groupId: string, query: string, limit: number): ChatMessage[] {
    const q = query.trim().toLowerCase()
    if (q === '') return []
    const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%'
    const rows = this.db.prepare(
      `SELECT * FROM messages
       WHERE groupId = ? AND kind = 'text' AND ulower(text) LIKE ? ESCAPE '\\'
       ORDER BY createdAt DESC, id DESC LIMIT ?`,
    ).all(groupId, like, limit)
    return rows.map((r) => this.toMessage(r))
  }
  searchAllMessagesFor(userId: string, query: string, limit: number): ChatMessage[] {
    const q = query.trim().toLowerCase()
    if (q === '') return []
    const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%' // 转义 LIKE 通配符，按字面量匹配（与上两者一致）
    // 授权边界=参与：单聊须本人为收/发方；群消息须本人此刻在群成员表里（groupsFor 已做精确成员过滤）。
    // 群 id 动态占位符：群数量级小（人均几个），IN 列表远在 SQLite 999 参数上限内。
    const myGroupIds = this.groupsFor(userId).map((g) => g.id)
    const groupClause = myGroupIds.length > 0 ? ` OR groupId IN (${myGroupIds.map(() => '?').join(',')})` : ''
    const rows = this.db.prepare(
      `SELECT * FROM messages
       WHERE kind = 'text' AND ulower(text) LIKE ? ESCAPE '\\'
         AND ((groupId IS NULL AND (fromId = ? OR toId = ?))${groupClause})
       ORDER BY createdAt DESC, id DESC LIMIT ?`,
    ).all(like, userId, userId, ...myGroupIds, limit)
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
  deleteGroupReadsForUser(userId: string): void {
    this.db.prepare('DELETE FROM group_reads WHERE userId = ?').run(userId)
  }
  setGroupMuted(groupId: string, userId: string, muted: boolean): void {
    if (muted) this.db.prepare('INSERT OR IGNORE INTO group_mutes (groupId, userId) VALUES (?, ?)').run(groupId, userId)
    else this.db.prepare('DELETE FROM group_mutes WHERE groupId = ? AND userId = ?').run(groupId, userId)
  }
  isGroupMuted(groupId: string, userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM group_mutes WHERE groupId = ? AND userId = ?').get(groupId, userId)
  }
  groupMutesForUser(userId: string): string[] {
    return (this.db.prepare('SELECT groupId FROM group_mutes WHERE userId = ?').all(userId) as { groupId: string }[]).map((r) => r.groupId)
  }
  deleteGroupMutesForUser(userId: string): void {
    this.db.prepare('DELETE FROM group_mutes WHERE userId = ?').run(userId)
  }
  setDmMuted(muterId: string, peerId: string, muted: boolean): void {
    if (muted) this.db.prepare('INSERT OR IGNORE INTO dm_mutes (muterId, peerId) VALUES (?, ?)').run(muterId, peerId)
    else this.db.prepare('DELETE FROM dm_mutes WHERE muterId = ? AND peerId = ?').run(muterId, peerId)
  }
  isDmMuted(muterId: string, peerId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM dm_mutes WHERE muterId = ? AND peerId = ?').get(muterId, peerId)
  }
  dmMutesForUser(userId: string): string[] {
    return (this.db.prepare('SELECT peerId FROM dm_mutes WHERE muterId = ?').all(userId) as { peerId: string }[]).map((r) => r.peerId)
  }
  deleteDmMutesForUser(userId: string): void {
    this.db.prepare('DELETE FROM dm_mutes WHERE muterId = ? OR peerId = ?').run(userId, userId)
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
  mediaByOwner(userId: string): MediaMeta[] {
    return (this.db.prepare('SELECT * FROM media WHERE ownerId = ?').all(userId) as any[])
      .map((row) => ({ id: row.id, ownerId: row.ownerId, mime: row.mime, size: Number(row.size), createdAt: Number(row.createdAt) }))
  }
  visionCallsOnDay(userId: string, day: string): number {
    const row = this.db.prepare('SELECT count FROM vision_usage WHERE userId = ? AND day = ?').get(userId, day) as { count: number } | undefined
    return row ? Number(row.count) : 0
  }
  recordVisionCall(userId: string, day: string): void {
    // 单行/用户 upsert：同日累加、跨日重置为 1（day 变即视为新的一天，count 归 1）。
    this.db.prepare(
      `INSERT INTO vision_usage (userId, day, count) VALUES (?, ?, 1)
       ON CONFLICT(userId) DO UPDATE SET count = CASE WHEN day = excluded.day THEN count + 1 ELSE 1 END, day = excluded.day`,
    ).run(userId, day)
  }
  refundVisionCall(userId: string, day: string): void {
    // 回退一次预留：仅当当前行仍是该 day 且 count>0（跨日已重置则不误减；WHERE count>0 保证不为负）。
    this.db.prepare('UPDATE vision_usage SET count = count - 1 WHERE userId = ? AND day = ? AND count > 0').run(userId, day)
  }
  deleteVisionUsageForUser(userId: string): void {
    this.db.prepare('DELETE FROM vision_usage WHERE userId = ?').run(userId)
  }
  mediaBytesForOwner(userId: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM media WHERE ownerId = ?').get(userId) as { total: number }
    return Number(row.total) // 走 idx_media_owner 索引扫描；配额检查每次上传一查，量级无虞
  }
  allMedia(): MediaMeta[] {
    return (this.db.prepare('SELECT * FROM media').all() as any[])
      .map((row) => ({ id: row.id, ownerId: row.ownerId, mime: row.mime, size: Number(row.size), createdAt: Number(row.createdAt) }))
  }
  referencedMediaIds(): Set<string> {
    const s = new Set<string>()
    for (const row of this.db.prepare("SELECT text FROM messages WHERE kind = 'video' AND text IS NOT NULL AND text != ''").all() as { text: string }[]) s.add(row.text)
    for (const row of this.db.prepare('SELECT mediaId FROM recordings WHERE mediaId IS NOT NULL').all() as { mediaId: string }[]) s.add(row.mediaId)
    return s
  }
  findVideoMessageByMediaId(mediaId: string): ChatMessage | undefined {
    const row = this.db.prepare("SELECT * FROM messages WHERE kind = 'video' AND text = ? LIMIT 1").get(mediaId)
    return row ? this.toMessage(row) : undefined
  }

  // MARK: row mappers
  private toMessage(r: any): ChatMessage {
    return { id: r.id, fromId: r.fromId, toId: r.toId, kind: (r.kind as ChatMessage['kind']) ?? 'text',
             text: r.text, createdAt: Number(r.createdAt), readAt: r.readAt != null ? Number(r.readAt) : undefined,
             reaction: r.reaction ?? undefined, groupId: r.groupId ?? undefined,
             editedAt: r.editedAt != null ? Number(r.editedAt) : undefined, replyTo: r.replyTo ?? undefined,
             forwarded: r.forwarded ? true : undefined }
  }
  private toGroup(r: any): ChatGroup {
    let memberIds: string[] = []
    // 损坏行视为空成员：既挡解析失败，也挡"解析成功但不是数组"（如 null/对象）——否则下游
    // memberIds.includes/.map/.filter 会崩。只收字符串元素，杜绝坏类型流入。
    try { const v = JSON.parse(r.memberIds); if (Array.isArray(v)) memberIds = v.filter((x): x is string => typeof x === 'string') } catch { /* 损坏行视为空成员 */ }
    return { id: r.id, name: r.name, ownerId: r.ownerId, memberIds, createdAt: Number(r.createdAt) }
  }
  private toUser(r: any): User {
    return { id: r.id, username: r.username, passwordHash: r.passwordHash, displayName: r.displayName, role: r.role as Role, status: r.status as UserStatus, createdAt: Number(r.createdAt), language: r.language ?? undefined, tokenVersion: r.tokenVersion != null ? Number(r.tokenVersion) : 0, email: r.email ?? undefined, emailVerified: r.emailVerified != null ? Number(r.emailVerified) === 1 : undefined, voipToken: r.voipToken ?? undefined, avatar: r.avatar ?? undefined, apnsToken: r.apnsToken ?? undefined, phone: r.phone ?? undefined, appleSub: r.appleSub ?? undefined, usernameCustomized: r.usernameCustomized != null ? Number(r.usernameCustomized) === 1 : undefined, legalConsentVersion: r.legalConsentVersion ?? undefined, legalConsentAt: r.legalConsentAt != null ? Number(r.legalConsentAt) : undefined, helperGuidelineAckAt: r.helperGuidelineAckAt != null ? Number(r.helperGuidelineAckAt) : undefined, featureOverrides: parseJsonOrUndefined(r.featureOverrides), totpSecret: r.totpSecret ?? undefined, totpEnabled: r.totpEnabled != null ? Number(r.totpEnabled) === 1 : undefined, totpLastCounter: r.totpLastCounter != null ? Number(r.totpLastCounter) : undefined, identityVerified: r.identityVerified != null ? Number(r.identityVerified) === 1 : undefined, quietHours: parseJsonOrUndefined<QuietHours>(r.quietHours), mutedPushCategories: parseJsonOrUndefined<string[]>(r.mutedPushCategories), callHistorySeenAt: r.callHistorySeenAt != null ? Number(r.callHistorySeenAt) : undefined, readReceiptsEnabled: r.readReceiptsEnabled != null ? Number(r.readReceiptsEnabled) === 1 : undefined, dailyCheckin: parseJsonOrUndefined<DailyCheckin>(r.dailyCheckin), dailyCheckinLastDay: r.dailyCheckinLastDay ?? undefined }
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
  private toVerification(r: any): Verification {
    return {
      id: r.id, userId: r.userId, status: r.status as VerificationStatus, idType: r.idType,
      idLast4: r.idLast4 ?? undefined,
      nameSealed: parseJsonOrUndefined(r.nameSealed),
      idNumberSealed: parseJsonOrUndefined(r.idNumberSealed),
      blobs: parseJsonOrUndefined<KycBlobRef[]>(r.blobs),
      submittedVia: (r.submittedVia ?? 'self') as 'self' | 'assisted',
      submittedById: r.submittedById ?? r.userId,
      consentToken: r.consentToken ?? undefined,
      consentVersion: r.consentVersion ?? undefined,
      legalHold: r.legalHold != null ? Number(r.legalHold) === 1 : undefined,
      submittedAt: Number(r.submittedAt),
      decidedBy: r.decidedBy ?? undefined,
      decidedAt: r.decidedAt != null ? Number(r.decidedAt) : undefined,
      rejectReasonCode: r.rejectReasonCode ?? undefined,
      rejectReasonNote: r.rejectReasonNote ?? undefined,
      attempt: r.attempt != null ? Number(r.attempt) : 1,
    }
  }
}
