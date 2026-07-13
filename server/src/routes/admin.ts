import type { FastifyInstance } from 'fastify'
import { readFileSync, unlinkSync } from 'node:fs'
import { buildUserExportBundle, SELF_ONLY_EXPORT_KEYS } from '../account/exportBundle'
import { passwordPolicyError } from '../auth/passwordPolicy'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PKG_VERSION, gitCommit } from '../version'
import { diskUsage, isDiskLow, dataDir } from '../monitoring/disk'
import { visionDailyMax } from './vision'
import { latestBackupInfo, backupKeepDays } from '../backup/autoBackup'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type Role, type User, type AdminAuditEntry, type FeatureKey, type EmergencyEvent, FEATURE_KEYS, publicUser } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { hashPassword } from '../auth/passwords'
import { normalizePhone } from '../auth/apple'
import { cascadeDeleteUser } from '../db/cascade'
import type { PresenceRegistry } from '../assist/presence'
import { type SignalingHub } from '../signaling/hub'
import { type CallControlBridge } from '../signaling/callControl'
import { type PushSender, NoopPushSender } from '../push/apns'
import { type Mailer, NoopMailer } from '../mail/mailer'
import { type Metrics } from '../metrics/metrics'
import { pushLang, pushStrings } from '../push/pushStrings'
import { notifyUser, notifyAccountSecurity } from '../notifications/notify'
import { openField, open as openSealed } from '../kyc/crypto'
import { readKycBlob, removeKycBlob, kycBlobExists } from '../kyc/storage'
import type { KycDocKind } from '../db/store'

const statusSchema = z.object({ status: z.enum(['active', 'disabled']) })
const roleSchema = z.object({ role: z.enum(['blind', 'helper', 'family', 'admin', 'developer']) })
// 审核处置阶梯：忽略 / 警告（不封）/ 暂停（封禁+强制下线）/ 封禁（封禁+强制下线，记为最重处置）。
const moderateSchema = z.object({
  action: z.enum(['dismiss', 'warn', 'suspend', 'ban']),
  reason: z.string().trim().min(1).max(1000),
})
// 功能开关补丁：每个键可选（逐键合并）。安全攸关的 紧急/拉黑/举报 不在此列——刻意不可关停。
// 派生自 FEATURE_KEYS（而非硬编码列表），避免新增功能开关时漏加：locationSharing 曾因硬编码遗漏，
// 导致全站 features.locationSharing 被 z.object 静默剥离、管理员无法全站关闭位置共享（仅 per-user override 生效）。
const featuresSchema = z.object(
  Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean()])) as Record<FeatureKey, z.ZodBoolean>,
).partial()
const announcementSchema = z.object({ active: z.boolean(), message: z.string().max(500), level: z.enum(['info', 'warning']) }).partial()
const maintenanceSchema = z.object({ active: z.boolean(), message: z.string().max(500) }).partial()
const contentFilterSchema = z.object({ enabled: z.boolean(), terms: z.array(z.string().trim().min(1).max(100)).max(500) }).partial()
const configSchema = z.object({
  registrationEnabled: z.boolean(), features: featuresSchema,
  announcement: announcementSchema, maintenance: maintenanceSchema, contentFilter: contentFilterSchema,
  requireVerification: z.boolean(),
}).partial()
// 实名审核拒绝原因（timeout/revoked 为系统/撤销专用，不在管理员可选项内）。
const kycRejectSchema = z.object({
  reasonCode: z.enum(['blurry', 'glare', 'name_mismatch', 'face_mismatch', 'expired', 'unsupported_doc', 'incomplete', 'suspected_fraud', 'other']),
  note: z.string().trim().max(280).optional(),
})


const START_MS = Date.now()

export function registerAdminRoutes(app: FastifyInstance, store: Store, presence: PresenceRegistry, metrics: Metrics, hub?: SignalingHub, callControl?: CallControlBridge, push: PushSender = new NoopPushSender(), mailer: Mailer = new NoopMailer()): void {
  const adminOnly = { preHandler: requireAuth(['admin']) }
  // 当前活跃管理员数（用于"最后一名管理员"保护，防把后台锁死）。
  const activeAdminCount = () => store.allUsers().filter((u) => u.role === 'admin' && u.status === 'active').length
  // 强制下线一名用户：撤销全部 refresh token + 递增 tokenVersion（在线 access token 立即失效、被登出会话即时撤销）。
  // 封禁(单/批量/举报处置)、force-logout、代设密码共用此原语——把"必须同时撤销会话"收敛一处，杜绝各自 inline 的漂移
  // （曾致单用户封禁只改 status 不撤会话，见修复）。patch 承载 status/passwordHash 等附加变更；tokenVersion 恒在 patch 之后，不可被覆盖。
  const severSessions = (id: string, currentTv: number, patch: Partial<User> = {}) => {
    store.deleteRefreshTokensForUser(id)
    const updated = store.updateUser(id, { ...patch, tokenVersion: currentTv + 1 })
    // 会话撤销须同时踢掉在线 /ws：仅删 refresh + 升 tokenVersion 只对 REST 与后续重连即时生效，
    // 已打开的信令 socket 会继续中继通话帧至 access token 到期。disconnectUser 立即关闭之（见 WS-AUTH 补全）。
    callControl?.disconnectUser(id)
    return updated
  }
  // 封禁专用（在 severSessions 之上加封禁特有的清理）：连带删浏览器推送订阅——被封账号不该
  // 继续收到家人告警/消息推送（其 web 端已无法登录，推送只剩泄漏面）。**只封禁走此路**：
  // 代设密码/force-logout 仍走 severSessions（清订阅会静默弄断该用户重登后的推送，需其手动重开）。
  const banUser = (id: string, currentTv: number) => {
    store.deleteWebPushSubscriptionsForUser(id)
    return severSessions(id, currentTv, { status: 'disabled' })
  }
  const nameOf = (id: string) => store.findById(id)?.displayName ?? '—'

  // 举报处理后通知通话双方（持久站内通知 + 离线推送）。隐私：两条文案都不点名对方、
  // 举报人不被告知对对方的具体处罚。decision 为空（旧 /resolve 路径）时给通用文案。
  const notifyReportResolved = (report: { id: string; reporterId: string; targetUserId: string; decision?: string }) => {
    // 每个收件人**单独**构造结构化数据：举报人的通知绝不含 decision——否则其可经 GET /api/notifications
    // 读到对对方的具体处罚（'banned' 等），破坏"举报人不知对方处罚"的隐私承诺（见复审 NOTIFY-LEAK）。
    const reporter = store.findById(report.reporterId)
    if (reporter) {
      const l = pushLang(reporter.language)
      notifyUser(store, push, report.reporterId, 'report_resolved', pushStrings.reportResolvedTitle(l), pushStrings.reportResolvedReporterBody(report.decision, l), { reportId: report.id })
    }
    const target = store.findById(report.targetUserId)
    if (target) {
      const l = pushLang(target.language)
      // 被举报人可被告知关于自己的结果（含 decision）。
      notifyUser(store, push, report.targetUserId, 'report_resolved', pushStrings.reportResolvedTitle(l), pushStrings.reportResolvedTargetBody(report.decision, l), { reportId: report.id, ...(report.decision ? { decision: report.decision } : {}) })
    }
  }
  // 审计：每个有副作用的后台操作都落一条不可抵赖的日志（谁、何时、对谁、做了什么）。
  const audit = (adminId: string, action: string, targetType: AdminAuditEntry['targetType'], targetId: string, detail?: string) =>
    store.createAuditEntry({ id: randomUUID(), adminId, action, targetType, targetId, detail, at: Date.now() })

  // 紧急事件日志（值守/事后追溯）：谁在何时触发了摔倒/车祸/SOS、通知到几人、位置来源（诚实标注）。
  // 坐标为敏感 PII——仅 admin 可见；查看不逐次审计（高频轮询会刷爆审计日志；导出级别的整库操作才审计）。
  // 列表 = 最近 100 条 ∪ **全部进行中**（未解除∧近 24h）：概览的 activeEmergencies 是全量计数（见 overview），
  // 若列表只取最近 100，高峰期被挤出窗口的进行中事件会"计数里有、列表里找不到"——待介入红标必须始终可见。
  app.get('/api/admin/emergencies', adminOnly, async () => {
    const merged = new Map<string, EmergencyEvent>()
    for (const e of store.recentEmergencyEvents(100)) merged.set(e.id, e)
    for (const e of store.openEmergencyEventsSince(Date.now() - 24 * 3600_000)) merged.set(e.id, e)
    const events = [...merged.values()].sort((a, b) => b.at - a.at).map((e) => {
      const u = store.findById(e.userId)
      return { ...e, userName: u?.displayName ?? null, username: u?.username ?? null }
    })
    return { events }
  })

  // 数据库备份下载（灾难恢复，自托管运维刚需）：VACUUM INTO 一致性快照 → 流回管理员。
  // 含全部账号/亲友/通知等 PII —— admin-only + 不可抵赖审计（与旁观通话同口径）。媒体文件在磁盘
  // 目录不在库内，本备份为元数据库；未用 SQLite 驱动（内存/JSON 存储）时诚实 503，绝不给假备份。
  app.get('/api/admin/backup', adminOnly, async (req, reply) => {
    if (typeof store.backupTo !== 'function') return reply.code(503).send({ error: 'backup_unavailable' })
    const tmp = join(tmpdir(), `beeurei-backup-${randomUUID()}.db`)
    try {
      store.backupTo(tmp)
      const buf = readFileSync(tmp)
      audit(req.user!.sub, 'db.backup', 'config', 'database', `${buf.length} bytes`)
      const stamp = new Date().toISOString().slice(0, 16).replaceAll(/[-:]/g, '').replace('T', '-')
      reply.header('content-type', 'application/octet-stream')
      reply.header('content-disposition', `attachment; filename="beeurei-backup-${stamp}.db"`)
      return reply.send(buf)
    } finally {
      try { unlinkSync(tmp) } catch { /* 临时文件已清或未生成 */ }
    }
  })

  // SMTP 自检：管理员主动发一封测试邮件，**当场**验证发信链路（尤其配好/改好 SMTP 凭据后，不必等真实用户
  // 撞发码失败才知道好没好——与"应急就绪自检"发测试告警同思路）。发到管理员指定地址（默认本人已验证邮箱）。
  // 成功=SMTP 通；失败把上游报错(如 535 授权失败)如实回给管理员诊断（admin-only，不外泄）。3/min 限流防滥发。
  const mailTestSchema = z.object({ to: z.string().trim().email().max(254).optional() })
  app.post('/api/admin/mail-test', { preHandler: requireAuth(['admin']), config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = mailTestSchema.safeParse(req.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_email' })
    const me = store.findById(req.user!.sub)
    // 收件人：显式指定优先；否则回落本人**已验证**邮箱（未验证不发，免发到打错的地址）。
    const to = parsed.data.to ?? (me?.email && me.emailVerified ? me.email : undefined)
    if (!to) return reply.code(400).send({ error: 'no_recipient' }) // 既没指定、本人也无已验证邮箱
    const stamp = new Date().toISOString()
    try {
      await mailer.send(to, 'BeeUrEi SMTP 测试 / SMTP test',
        `这是一封来自 BeeUrEi 管理后台的 SMTP 自检邮件。收到即表示发信链路正常。\nThis is an SMTP self-test from the BeeUrEi admin panel. Receiving it means email delivery works.\n\n${stamp}`)
      audit(req.user!.sub, 'mail.test', 'config', 'smtp', `→ ${to.replace(/(.{2}).*(@.*)/, '$1***$2')}`)
      return { ok: true }
    } catch (e) {
      // 上游报错如实回管理员（诊断 SMTP，如 163 授权码过期的 535）——admin-only 语境，不外泄给普通用户。
      audit(req.user!.sub, 'mail.test', 'config', 'smtp', `FAILED: ${(e as Error).message}`)
      return reply.code(502).send({ ok: false, error: 'mail_failed', detail: (e as Error).message.slice(0, 300) })
    }
  })

  // 后台总览（仪表盘）：用户/角色/在线/举报/录制聚合统计。
  app.get('/api/admin/overview', adminOnly, async () => {
    const now = Date.now()
    const users = store.allUsers()
    const online = presence.availableUserIds(now)
    const byRole: Record<string, number> = { blind: 0, helper: 0, family: 0, admin: 0, developer: 0 }
    let active = 0
    let disabled = 0
    for (const u of users) {
      byRole[u.role] = (byRole[u.role] ?? 0) + 1
      if (u.status === 'active') active++
      else disabled++
    }
    const reports = store.allReports()
    const openReports = reports.filter((r) => r.status === 'open').length
    const onlineHelpers = users.filter(
      (u) => (u.role === 'helper' || u.role === 'family') && online.has(u.id),
    ).length
    // 注册增长：最近 30 个自然日（UTC）每日新增 + 近 7/30 天滚动新增，供仪表盘趋势图与判断活跃度。
    const DAY = 86_400_000
    const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)
    const trend: { date: string; count: number }[] = []
    const trendIdx = new Map<string, number>()
    for (let i = 29; i >= 0; i--) {
      const key = dayKey(now - i * DAY)
      trendIdx.set(key, trend.length)
      trend.push({ date: key, count: 0 })
    }
    let newUsers7d = 0
    let newUsers30d = 0
    const cutoff7 = now - 7 * DAY
    const cutoff30 = now - 30 * DAY
    for (const u of users) {
      if (u.createdAt >= cutoff7) newUsers7d++
      if (u.createdAt >= cutoff30) newUsers30d++
      const i = trendIdx.get(dayKey(u.createdAt))
      if (i !== undefined) trend[i].count++
    }
    // 当前正在进行的紧急（未解除 ∧ 近 24h）：一次取出，既数活跃总数、又数其中"未触达任何人"的。
    // **全量**查询（openEmergencyEventsSince），非 recentEmergencyEvents(N).filter——那是"最近 N 条"窗口，
    // 高峰期未解除的旧事件掉出窗口会让危机计数**少报**（管理员误信"没有活跃紧急"，假安心；b03ebba 列表截断的姊妹）。
    const activeEmerg = store.openEmergencyEventsSince(now - DAY)
    return {
      users: { total: users.length, active, disabled, byRole },
      online: { total: online.size, helpers: onlineHelpers },
      reports: { open: openReports, total: reports.length },
      recordings: { total: store.allRecordings().length, config: store.getRecordingConfig() },
      // AI 视觉描述用量（今日 UTC）：每次成功=一次外部付费调用，运维据此监控成本/滥用（无专门 metrics 面板亦可见）。
      // today=全体当日成功调用数；dailyMaxPerUser=单用户每日上限（VISION_DAILY_MAX，默认 200）。
      vision: {
        today: store.totalVisionCallsOnDay(dayKey(now)), dailyMaxPerUser: visionDailyMax(),
        // AI 视觉「描述场景/Be My AI」健康：errors=上游失败累计（provider 故障/配额/VISION_* 配错）；lastError=最后原因
        //（如 `401: invalid api key`）。盲人识别骨干功能挂了运维一眼可见，不必等用户报"描述用不了"。
        errors: metrics.get('vision_errors_total'),
        lastError: metrics.getNote('vision_last_error')?.value ?? null,
        lastErrorAt: metrics.getNote('vision_last_error')?.at ?? null,
      },
      verifications: { pending: store.countPendingVerifications(), total: store.allVerifications().length },
      growth: { newUsers7d, newUsers30d, trend },
      // 运维在仪表盘一眼看出此刻有没有正在发生的危机，无需先点进紧急事件区逐条看（危机感知置顶）。
      activeEmergencies: activeEmerg.length,
      // 其中"未触达任何人"（notified===0）的活跃紧急：安全网**当下正在静默失效**——最该运维立刻人工介入
      // （联系本人/其亲友）的信号。自托管者未必跑 Prometheus（emergency_unreachable_total 累计计数看不到），
      // per-event「未触达任何人」红标又要滚列表才见——故把这个点时计数直接摆到概览、逼近置顶。
      activeUnreachable: activeEmerg.filter((e) => e.notified === 0).length,
      // 通话连接失败（自本次进程启动以来累计，与 uptime/online 同为"当前健康"信号）：把客户端 ICE 失败上报
      // （见 /api/assist/call-failure）呈现在运维实际看的面板里——relay 不可达尤其指向 TURN/安全组故障。
      callConnect: {
        relayUnreachable: metrics.get('call_ice_failure_relay_unreachable_total'),
        generic: metrics.get('call_ice_failure_generic_total'),
        signaling: metrics.get('call_ice_failure_signaling_total'),
      },
      // 高德导航依赖健康（导航/周边/地理编码/公交全靠它，是盲人过城的骨干）：此前面板完全不可见——高德挂/key 配错时
      // 运维只能等用户报"导航用不了"。upstreamErrors=key平台不符/配额/上游 4xx-5xx（**配置问题**，最该修）；
      // timeouts/netErrors=网络/慢；lastError=最后一次失败原因（如 USERKEY_PLAT_NOMATCH＝key 非 Web服务类型）。
      amap: {
        calls: metrics.get('amap_calls_total'),
        upstreamErrors: metrics.get('amap_upstream_errors_total'),
        timeouts: metrics.get('amap_timeouts_total'),
        netErrors: metrics.get('amap_errors_total'),
        breakerOpen: metrics.get('amap_breaker_open_total'),
        lastError: metrics.getNote('amap_last_error')?.value ?? null,
        lastErrorAt: metrics.getNote('amap_last_error')?.at ?? null,
      },
      // 磁盘余量（数据卷所在文件系统）：满盘=sqlite 写失败整站瘫（自托管头号慢性死亡）。
      // low=剩余 <10% 或 <2GiB（见 monitoring/disk.ts）；statfs 失败→null（诚实缺席，面板不渲染）。
      disk: (() => {
        const u = diskUsage(dataDir())
        return u ? { freeBytes: u.freeBytes, totalBytes: u.totalBytes, low: isDiskLow(u) } : null
      })(),
      // 备份新鲜度：运维一眼看"每日备份还在跑吗"，无需 SSH 跑演练脚本。启用了却陈旧/一份都没有 = 灾备正静默失效。
      // 显式关闭（BACKUP_KEEP_DAYS=0，运营者自有异地方案）→ null，不告警（合法意图，同磁盘 statfs 失败的诚实缺席）。
      backup: backupKeepDays() > 0 ? latestBackupInfo(Date.now()) : null,
      // 邮件送达健康（自启动累计）：failed>0 = SMTP 凭据/连接故障（如 163 授权码过期），发码/找回密码/安全告警
      // 邮件发不出去——运维一眼可见并去修 SMTP_*，不必翻日志等用户报障。
      mail: {
        sent: metrics.get('mail_sent_total'),
        failed: metrics.get('mail_failed_total'),
        // 最后一次发信失败的原因（如 SMTP 535 authentication failed）+ 时刻：failed>0 时运维一眼知"为什么"，不必翻日志。
        lastError: metrics.getNote('mail_last_error')?.value ?? null,
        lastErrorAt: metrics.getNote('mail_last_error')?.at ?? null,
      },
      // 安全引擎 tick 报错累计：>0 = 后台升级/报到告警在异常（DB 锁/bug），dead-man's-switch 可能悄悄失灵。
      // 与 mail 同理摆到概览，让不跑 Prometheus 的自托管运维也看得见（引擎失灵是生命攸关，绝不能只躺日志）。
      safetyTickErrors: metrics.get('safety_tick_errors_total'),
      version: PKG_VERSION,
      commit: gitCommit(), // 部署验证：后台一眼确认线上提交
      uptimeSeconds: Math.floor((now - START_MS) / 1000),
      nowMs: now,
    }
  })

  // —— 实名认证（KYC）人工审核 ——
  // 队列：仅元数据，绝不含姓名/证件号/图片。默认 status=pending。
  app.get('/api/admin/verifications', adminOnly, async (req) => {
    const q = req.query as { status?: string }
    const status = q.status === 'verified' || q.status === 'rejected' || q.status === 'pending' ? q.status : 'pending'
    const list = store.listVerifications(status as 'pending' | 'verified' | 'rejected', 200)
    return {
      verifications: list.map((v) => ({
        id: v.id, userId: v.userId, userName: nameOf(v.userId), status: v.status,
        idType: v.idType, idLast4: v.idLast4 ?? null, submittedVia: v.submittedVia, attempt: v.attempt,
        docsUploaded: (v.blobs ?? []).map((b) => b.kind),
        legalHold: !!v.legalHold, submittedAt: v.submittedAt, decidedAt: v.decidedAt ?? null,
        decidedBy: v.decidedBy ?? null, rejectReasonCode: v.rejectReasonCode ?? null,
      })),
      pending: store.countPendingVerifications(),
    }
  })

  // 审核详情：**唯一**产出明文姓名/证件号的端点。每次调用审计 kyc.view（谁看了谁的证件）。
  app.get('/api/admin/verifications/:id', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const v = store.findVerification(id)
    if (!v) return reply.code(404).send({ error: 'not_found' })
    if (v.userId === req.user!.sub) return reply.code(403).send({ error: 'cannot_review_self' }) // 自审禁止：不得解密查看本人提交
    let legalName: string | null = null
    let idNumber: string | null = null
    try { if (v.nameSealed) legalName = openField(v.nameSealed, { submissionId: v.id, kind: 'name' }) } catch { /* 已清除或不可解 */ }
    try { if (v.idNumberSealed) idNumber = openField(v.idNumberSealed, { submissionId: v.id, kind: 'idNumber' }) } catch { /* 已清除 */ }
    audit(req.user!.sub, 'kyc.view', 'kyc', id, `name disclosed · ${v.idType}`)
    return {
      id: v.id, userId: v.userId, userName: nameOf(v.userId), status: v.status,
      idType: v.idType, idLast4: v.idLast4 ?? null, legalName, idNumber,
      docsUploaded: (v.blobs ?? []).map((b) => b.kind),
      submittedVia: v.submittedVia, attempt: v.attempt, consentVersion: v.consentVersion ?? null,
      legalHold: !!v.legalHold, submittedAt: v.submittedAt, decidedAt: v.decidedAt ?? null,
      decidedBy: v.decidedBy ?? null, rejectReasonCode: v.rejectReasonCode ?? null, rejectReasonNote: v.rejectReasonNote ?? null,
    }
  })

  // 审核详情中的单张证件图片：解密 → 流式返回。审计 kyc.view-doc。no-store 不缓存；无 token-in-URL（SPA 带 Authorization 头取 blob）。
  app.get('/api/admin/verifications/:id/doc/:kind', adminOnly, async (req, reply) => {
    const { id, kind } = req.params as { id: string; kind: string }
    const v = store.findVerification(id)
    if (!v) return reply.code(404).send({ error: 'not_found' })
    if (v.userId === req.user!.sub) return reply.code(403).send({ error: 'cannot_review_self' }) // 自审禁止：不得解密查看本人证件图
    const ref = (v.blobs ?? []).find((b) => b.kind === kind)
    if (!ref || !kycBlobExists(ref.blobId)) return reply.code(404).send({ error: 'not_found' }) // 已按留存清除
    let plain: Buffer
    try {
      plain = openSealed(ref.sealed, await readKycBlob(ref.blobId), { submissionId: v.id, kind: kind as KycDocKind })
    } catch {
      return reply.code(404).send({ error: 'not_found' })
    }
    audit(req.user!.sub, 'kyc.view-doc', 'kyc', id, kind)
    reply.header('content-type', ref.mime)
    reply.header('cache-control', 'private, no-store')
    reply.header('content-disposition', 'inline')
    return reply.send(plain)
  })

  // 通过：状态→verified、置用户徽章、清证件号+图片（保留加密姓名作徽章法律依据）、审计、通知。
  app.post('/api/admin/verifications/:id/approve', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const adminId = req.user!.sub
    const v = store.findVerification(id)
    if (!v) return reply.code(404).send({ error: 'not_found' })
    if (v.userId === adminId) return reply.code(403).send({ error: 'cannot_review_self' })
    if (v.status !== 'pending') return reply.code(409).send({ error: 'not_pending' })
    const blobs = v.blobs ?? []
    const decided = store.decideVerification(id, {
      status: 'verified', decidedBy: adminId, decidedAt: Date.now(), idNumberSealed: undefined, blobs: undefined,
    })
    if (!decided) return reply.code(409).send({ error: 'not_pending' }) // 竞态败者——不重复副作用
    for (const b of blobs) removeKycBlob(b.blobId)
    store.updateUser(v.userId, { identityVerified: true })
    audit(adminId, 'kyc.approve', 'kyc', id, `attempt ${v.attempt}`)
    const u = store.findById(v.userId)
    if (u) { const l = pushLang(u.language); notifyUser(store, push, v.userId, 'kyc_verified', pushStrings.kycVerifiedTitle(l), pushStrings.kycVerifiedBody(l), { status: 'verified' }) }
    return reply.send({ ok: true, status: 'verified' })
  })

  // 拒绝：状态→rejected、清姓名+证件号+图片、审计、通知（含原因码）。
  app.post('/api/admin/verifications/:id/reject', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const adminId = req.user!.sub
    const parsed = kycRejectSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const v = store.findVerification(id)
    if (!v) return reply.code(404).send({ error: 'not_found' })
    if (v.userId === adminId) return reply.code(403).send({ error: 'cannot_review_self' })
    if (v.status !== 'pending') return reply.code(409).send({ error: 'not_pending' })
    const blobs = v.blobs ?? []
    const decided = store.decideVerification(id, {
      status: 'rejected', decidedBy: adminId, decidedAt: Date.now(),
      rejectReasonCode: parsed.data.reasonCode, rejectReasonNote: parsed.data.note,
      nameSealed: undefined, idNumberSealed: undefined, blobs: undefined,
    })
    if (!decided) return reply.code(409).send({ error: 'not_pending' })
    for (const b of blobs) removeKycBlob(b.blobId)
    audit(adminId, 'kyc.reject', 'kyc', id, parsed.data.reasonCode)
    const u = store.findById(v.userId)
    if (u) { const l = pushLang(u.language); notifyUser(store, push, v.userId, 'kyc_rejected', pushStrings.kycRejectedTitle(l), pushStrings.kycRejectReason(parsed.data.reasonCode, l), { status: 'rejected', reasonCode: parsed.data.reasonCode }) }
    return reply.send({ ok: true, status: 'rejected' })
  })

  // 撤销已通过的徽章（如发现冒用）：verified→rejected(revoked)、清姓名、撤销徽章、审计、通知。
  app.post('/api/admin/verifications/:id/revoke', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const adminId = req.user!.sub
    const v = store.findVerification(id)
    if (!v) return reply.code(404).send({ error: 'not_found' })
    if (v.userId === adminId) return reply.code(403).send({ error: 'cannot_review_self' }) // 自审禁止：不得撤销本人认证
    if (v.status !== 'verified') return reply.code(409).send({ error: 'not_verified' })
    store.updateVerification(id, { status: 'rejected', rejectReasonCode: 'revoked', decidedBy: adminId, decidedAt: Date.now(), nameSealed: undefined, idNumberSealed: undefined, blobs: undefined })
    for (const b of v.blobs ?? []) removeKycBlob(b.blobId)
    store.updateUser(v.userId, { identityVerified: false })
    audit(adminId, 'kyc.revoke', 'kyc', id)
    const u = store.findById(v.userId)
    if (u) { const l = pushLang(u.language); notifyUser(store, push, v.userId, 'kyc_rejected', pushStrings.kycRejectedTitle(l), pushStrings.kycRejectReason('revoked', l), { status: 'rejected', reasonCode: 'revoked' }) }
    return reply.send({ ok: true })
  })

  // 法务保留开关：豁免留存清扫与级联删号清除（取证）。
  app.post('/api/admin/verifications/:id/hold', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const v = store.findVerification(id)
    if (!v) return reply.code(404).send({ error: 'not_found' })
    if (v.userId === req.user!.sub) return reply.code(403).send({ error: 'cannot_review_self' }) // 自审禁止：不得对本人记录置法务保留
    const on = !v.legalHold
    store.updateVerification(id, { legalHold: on })
    audit(req.user!.sub, 'kyc.hold', 'kyc', id, on ? 'on' : 'off')
    return reply.send({ ok: true, legalHold: on })
  })

  // 列出用户：服务端搜索/筛选/排序/分页（万级用户也不撑爆前端）。返回 { users, total, limit, offset }。
  // 兼容旧前端：不带任何 query 时默认返回全部（limit 很大）。
  app.get('/api/admin/users', adminOnly, async (req) => {
    const now = Date.now()
    const q = req.query as { q?: string; role?: string; status?: string; sort?: string; limit?: string; offset?: string }
    const term = (q.q ?? '').trim().toLowerCase()
    const roleF = q.role && q.role !== 'all' ? q.role : null
    const statusF = q.status && q.status !== 'all' ? q.status : null
    const limit = Math.min(Math.max(Number.parseInt(q.limit ?? '10000', 10) || 10000, 1), 10000)
    const offset = Math.max(Number.parseInt(q.offset ?? '0', 10) || 0, 0)
    // 搜索匹配：用户名/昵称/邮箱/手机（管理员可见，便于客服按联系方式定位）。
    let list = store.allUsers().filter((u) => {
      if (roleF && u.role !== roleF) return false
      if (statusF && u.status !== statusF) return false
      if (term) {
        const hay = `${u.username} ${u.displayName} ${u.email ?? ''} ${u.phone ?? ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
    // 排序：created（默认倒序）/ name / role / status。
    const sort = q.sort ?? 'created_desc'
    // 所有比较器以 id 兜底，保证 tied 行（同角色/状态、同毫秒创建、重名）顺序确定。
    // 否则回退到 allUsers() 顺序——SqliteStore 无 ORDER BY 不确定、且与 MemoryStore 插入序不一致，
    // 翻页(offset/limit)时 tied 行可能跨页重复/漏掉（同 (字段,id) 稳定序约定）。
    const byId = (a: typeof list[number], b: typeof list[number]) => a.id.localeCompare(b.id)
    const cmp: Record<string, (a: typeof list[number], b: typeof list[number]) => number> = {
      created_desc: (a, b) => ((b.createdAt || 0) - (a.createdAt || 0)) || byId(a, b),
      created_asc: (a, b) => ((a.createdAt || 0) - (b.createdAt || 0)) || byId(a, b),
      name_asc: (a, b) => (a.displayName || a.username).localeCompare(b.displayName || b.username) || byId(a, b),
      name_desc: (a, b) => (b.displayName || b.username).localeCompare(a.displayName || a.username) || byId(a, b),
      role_asc: (a, b) => a.role.localeCompare(b.role) || byId(a, b),
      status_asc: (a, b) => a.status.localeCompare(b.status) || byId(a, b),
    }
    list = [...list].sort(cmp[sort] ?? cmp.created_desc)
    const total = list.length
    const page = list.slice(offset, offset + limit)
    return {
      total, limit, offset,
      users: page.map((u) => ({
        ...publicUser(u),
        createdAt: u.createdAt,
        language: u.language ?? null,
        online: presence.isAvailable(u.id, now),
        hasEmail: !!u.email,
        hasPhone: !!u.phone,
        emailVerified: !!u.emailVerified,
        appleLinked: !!u.appleSub,
      })),
    }
  })

  // 批量操作：对多个用户一次性 封禁/解封/改角色/删除。逐个施加既有保护（不能动自己、最后管理员、级联删），
  // 返回每个 id 的结果（ok/原因），整体不因单个失败而中断。
  const bulkSchema = z.object({
    ids: z.array(z.string().min(1)).min(1).max(500),
    action: z.enum(['disable', 'enable', 'delete', 'role']),
    role: z.enum(['blind', 'helper', 'family', 'admin', 'developer']).optional(),
  })
  app.post('/api/admin/users/bulk', adminOnly, async (req, reply) => {
    const parsed = bulkSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const { ids, action, role } = parsed.data
    if (action === 'role' && !role) return reply.code(400).send({ error: 'role_required' })
    const adminId = req.user!.sub
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of [...new Set(ids)]) {
      const target = store.findById(id)
      if (!target) { results.push({ id, ok: false, error: 'not_found' }); continue }
      // 逐个保护，与单条端点一致。
      if ((action === 'disable' || action === 'delete') && id === adminId) { results.push({ id, ok: false, error: 'cannot_target_self' }); continue }
      if (action === 'role' && id === adminId) { results.push({ id, ok: false, error: 'cannot_change_own_role' }); continue }
      const losesActiveAdmin = target.role === 'admin' && target.status === 'active' &&
        (action === 'delete' || action === 'disable' || (action === 'role' && role !== 'admin'))
      if (losesActiveAdmin && activeAdminCount() <= 1) { results.push({ id, ok: false, error: 'last_admin_protected' }); continue }
      try {
        if (action === 'disable') { banUser(id, target.tokenVersion ?? 0); audit(adminId, 'user.disable', 'user', id, 'bulk') }
        else if (action === 'enable') { store.updateUser(id, { status: 'active' }); audit(adminId, 'user.enable', 'user', id, 'bulk') }
        else if (action === 'role') { store.updateUser(id, { role: role as Role }); audit(adminId, 'user.role', 'user', id, `bulk → ${role}`) }
        else if (action === 'delete') { cascadeDeleteUser(store, id); callControl?.disconnectUser(id); audit(adminId, 'user.delete', 'user', id, `bulk username=${target.username}`) }
        results.push({ id, ok: true })
      } catch { results.push({ id, ok: false, error: 'failed' }) }
    }
    return { results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }
  })

  // 单个用户详情——**全字段 + 全关联**，仅管理员可见。绝不外泄 passwordHash / 原始 token / appleSub 明文，
  // 改以"是否绑定"的布尔呈现；其余字段（含 tokenVersion、合规版本、会话数）全量给出，便于审核与排障。
  app.get('/api/admin/users/:id', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const u = store.findById(id)
    if (!u) return reply.code(404).send({ error: 'not_found' })
    const now = Date.now()
    // 绑定关系：盲人侧(owner) 与 协助侧(member) 两个方向合并，标出对方与状态。
    const links = [
      ...store.linksByOwner(id).map((l) => ({ direction: 'owner' as const, otherId: l.memberId, otherName: nameOf(l.memberId), relation: l.relation, isEmergency: l.isEmergency, status: l.status ?? 'accepted' })),
      ...store.linksByMember(id).map((l) => ({ direction: 'member' as const, otherId: l.ownerId, otherName: nameOf(l.ownerId), relation: l.relation, isEmergency: l.isEmergency, status: l.status ?? 'accepted' })),
    ]
    const recentCalls = store.callRecordsForUser(id, 20).map((c) => ({
      callId: c.callId,
      direction: c.callerId === id ? 'outgoing' : 'incoming',
      peerName: nameOf(c.callerId === id ? c.calleeId : c.callerId),
      status: c.status,
      createdAt: c.createdAt,
    }))
    // 拉黑：拆成"我拉黑了谁 / 谁拉黑了我"两向。
    const involvingBlocks = store.blocksInvolving(id)
    const blocking = involvingBlocks.filter((b) => b.blockerId === id).map((b) => ({ id: b.id, otherName: nameOf(b.blockedId), createdAt: b.createdAt }))
    const blockedBy = involvingBlocks.filter((b) => b.blockedId === id).map((b) => ({ id: b.id, otherName: nameOf(b.blockerId), createdAt: b.createdAt }))
    // 举报：该用户发起的 / 针对该用户的。
    const allReports = store.allReports()
    const reportsBy = allReports.filter((r) => r.reporterId === id).map((r) => ({ id: r.id, targetName: nameOf(r.targetUserId), reason: r.reason, status: r.status, decision: r.decision ?? null, createdAt: r.createdAt }))
    const reportsAgainst = allReports.filter((r) => r.targetUserId === id).map((r) => ({ id: r.id, reporterName: nameOf(r.reporterId), reason: r.reason, status: r.status, decision: r.decision ?? null, createdAt: r.createdAt }))
    const recordings = store.allRecordings().filter((r) => r.ownerId === id).map((r) => ({ id: r.id, callId: r.callId, reason: r.reason, recordedAt: r.recordedAt }))
    const passkeys = store.passkeysForUser(id).map((p) => ({ id: p.id, deviceName: p.deviceName ?? null, createdAt: p.createdAt, counter: p.counter }))
    // 该用户当日 AI 视觉调用量（付费第三方模型）——供审核员定位单个滥用/异常烧配额的用户，
    // 补齐 overview 只有全体总数、无法归因到人的观测缺口。dailyMax=单用户每日上限（同 overview）。
    const visionToday = store.visionCallsOnDay(id, new Date(now).toISOString().slice(0, 10))
    return {
      user: {
        ...publicUser(u),
        createdAt: u.createdAt,
        language: u.language ?? null,
        email: u.email ?? null,
        emailVerified: !!u.emailVerified,
        phone: u.phone ?? null,
        appleLinked: !!u.appleSub,
        usernameCustomized: !!u.usernameCustomized,
        tokenVersion: u.tokenVersion ?? 0,
        legalConsentVersion: u.legalConsentVersion ?? null,
        legalConsentAt: u.legalConsentAt ?? null,
        hasAvatar: !!u.avatar,
        hasVoipToken: !!u.voipToken,
        hasApnsToken: !!u.apnsToken,
        passkeyCount: passkeys.length,
        sessions: store.countSessionsForUser(id, now),
        online: presence.isAvailable(id, now),
        featureOverrides: u.featureOverrides ?? {}, // 单用户功能覆盖（仅记录被强制关停的键）
      },
      links,
      blocking,
      blockedBy,
      blockedCount: involvingBlocks.length,
      recentCalls,
      reportsBy,
      reportsAgainst,
      recordings,
      passkeys,
      // 该用户今日 AI 视觉调用量 + 单用户每日上限（付费用量归因，异常烧配额定位）。
      vision: { today: visionToday, dailyMax: visionDailyMax() },
      // 审核记录：该用户收到的警告（轻处置）历史，供审核员判断是否升级处置。
      warnings: store.warningsForUser(id).map((w) => ({
        id: w.id,
        reason: w.reason,
        byAdminName: nameOf(w.byAdminId),
        reportId: w.reportId ?? null,
        at: w.at,
      })),
    }
  })

  // —— GDPR/合规：导出某用户的全部个人数据（DSAR 数据访问请求）——
  // 刻意**不含聊天正文**：管理员一向不读消息，导出走管理员也不应破坏此隐私属性
  // （用户自己的消息导出应由 App 内自助流程提供）。这里给个人档案 + 全部关联 + 计数。
  app.get('/api/admin/users/:id/export', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const base = buildUserExportBundle(store, id, Date.now())
    if (!base) return reply.code(404).send({ error: 'not_found' })
    // 数据最小化的最后一道闸：底座本就不含本人专属敏感键（住址/健康/位置历史/消息正文/头像——这些只由
    // buildSelfExportExtras 构造），但在服务边界再防御性剔除一次。将来若有人误把某敏感块搬进底座，此处仍确保
    // admin 代办导出绝不外泄弱势用户的家庭住址/健康数据（约束由 SELF_ONLY_EXPORT_KEYS 单一事实源集中管辖）。
    const safeBase = base as Record<string, unknown>
    for (const k of SELF_ONLY_EXPORT_KEYS) delete safeBase[k]
    const data = {
      ...safeBase,
      exportedByAdminId: req.user!.sub,
      note: 'Chat message bodies are intentionally excluded to preserve conversation privacy; admins do not read messages. Tokens and password hashes are never exported.',
    }
    audit(req.user!.sub, 'user.export', 'user', id)
    reply.header('content-disposition', `attachment; filename="beeurei-user-${id}.json"`)
    return data
  })

  // 分配/变更角色（含晋升管理员/开发者——自助注册不可，仅 admin 可在此分配）。
  // requireAuth 每次都读库中最新 role，故变更服务端**立即生效**；客户端下次 /me 或重新登录后界面切换。
  app.post('/api/admin/users/:id/role', adminOnly, async (req, reply) => {
    const parsed = roleSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const id = (req.params as { id: string }).id
    if (id === req.user!.sub) return reply.code(400).send({ error: 'cannot_change_own_role' }) // 防管理员误把自己降级锁死
    const target = store.findById(id)
    if (!target) return reply.code(404).send({ error: 'not_found' })
    // 最后一名管理员保护：把唯一的活跃管理员降级会使后台无人可管（见审查 #11）。
    // 仅当目标本身是**活跃**管理员才计入——降级一个已封禁的管理员不减少活跃数，不应误拦（见复审 #6）。
    if (target.role === 'admin' && target.status === 'active' && parsed.data.role !== 'admin' && activeAdminCount() <= 1) {
      return reply.code(400).send({ error: 'last_admin_protected' })
    }
    const from = target.role
    const updated = store.updateUser(id, { role: parsed.data.role as Role })
    audit(req.user!.sub, 'user.role', 'user', id, `${from} → ${parsed.data.role}`)
    return { user: publicUser(updated!) }
  })

  // 封禁 / 解封（设置 status）。
  app.post('/api/admin/users/:id/status', adminOnly, async (req, reply) => {
    const parsed = statusSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const id = (req.params as { id: string }).id
    // 防自封锁死后台：管理员一旦封禁自己，requireAuth 立即拒绝其后续所有请求（含解封），无法自救（见审查 #10）。
    if (id === req.user!.sub && parsed.data.status === 'disabled') {
      return reply.code(400).send({ error: 'cannot_disable_self' })
    }
    const target = store.findById(id)
    if (!target) return reply.code(404).send({ error: 'not_found' })
    // 最后一名管理员保护：封禁唯一活跃管理员会使后台无人可管（见审查 #10/#11）。
    // 仅当目标**当前就是活跃**管理员才计入——再次封禁一个已封禁的管理员不减少活跃数，不应误拦 last_admin_protected
    // （与 /role 端点同一修复口径，见复审 #6；此前 status 端点漏了 target.status==='active' 这一环）。
    if (target.role === 'admin' && target.status === 'active' && parsed.data.status === 'disabled' && activeAdminCount() <= 1) {
      return reply.code(400).send({ error: 'last_admin_protected' })
    }
    // 封禁即吊销会话（severSessions 与批量封禁/force-logout 同口径：删 refresh + 递增 tokenVersion，
    // 使在线 access token 立即失效、解封后须重新登录）。解封(enable)只改 status、不动会话。
    const updated = parsed.data.status === 'disabled'
      ? banUser(id, target.tokenVersion ?? 0)
      : store.updateUser(id, { status: 'active' })
    audit(req.user!.sub, parsed.data.status === 'disabled' ? 'user.disable' : 'user.enable', 'user', id)
    return { user: publicUser(updated!) }
  })

  // 举报列表（解析举报人/被举报人显示名 + 处置结果，便于审核与回溯）。
  app.get('/api/admin/reports', adminOnly, async () => {
    return {
      reports: store.allReports().map((r) => ({
        ...r,
        reporterName: store.findById(r.reporterId)?.displayName ?? '未知',
        targetName: store.findById(r.targetUserId)?.displayName ?? '未知',
        resolvedByName: r.resolvedBy ? (store.findById(r.resolvedBy)?.displayName ?? '—') : null,
      })),
    }
  })

  // 处理举报（仅标记已解决，不附带处置——保留向后兼容；正式审核走 /moderate）。
  app.post('/api/admin/reports/:id/resolve', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const before = store.findReport(id)
    if (!before) return reply.code(404).send({ error: 'not_found' })
    const updated = store.updateReport(id, { status: 'resolved', resolvedBy: req.user!.sub, resolvedAt: Date.now() })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    audit(req.user!.sub, 'report.resolve', 'report', id)
    // 仅在首次由 open → resolved 时通知双方一次（防重复处置重复打扰，见复审 DOUBLE-NOTIFY）。
    if (before.status !== 'resolved') notifyReportResolved(updated)
    return { report: updated }
  })

  // 审核处置（内容审核核心）：对一条举报作出 忽略/警告/暂停/封禁 决定，
  // 一次调用同时（1）落处置结果到举报（2）对被举报用户施加相应后果（3）落审计日志。
  app.post('/api/admin/reports/:id/moderate', adminOnly, async (req, reply) => {
    const parsed = moderateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const id = (req.params as { id: string }).id
    const report = store.findReport(id)
    if (!report) return reply.code(404).send({ error: 'not_found' })
    const { action, reason } = parsed.data
    const targetId = report.targetUserId
    const target = store.findById(targetId)
    if (!target) return reply.code(404).send({ error: 'target_not_found' })
    const adminId = req.user!.sub

    // 不能对自己或（封禁动作下）唯一活跃管理员动手，防误锁后台。
    if ((action === 'suspend' || action === 'ban')) {
      if (targetId === adminId) return reply.code(400).send({ error: 'cannot_disable_self' })
      if (target.role === 'admin' && target.status === 'active' && activeAdminCount() <= 1) {
        return reply.code(400).send({ error: 'last_admin_protected' })
      }
    }

    const decision = action === 'dismiss' ? 'dismissed' : action === 'warn' ? 'warned' : action === 'suspend' ? 'suspended' : 'banned'
    if (action === 'warn') {
      // 轻处置：记一条用户警告，不封号。
      store.createWarning({ id: randomUUID(), userId: targetId, reason, byAdminId: adminId, reportId: id, at: Date.now() })
    } else if (action === 'suspend' || action === 'ban') {
      // 重处置：封禁 + 强制下线（已签发 token 立即失效、撤销 refresh token），防被封后仍在线。
      banUser(targetId, target.tokenVersion ?? 0)
    }
    const updated = store.updateReport(id, { status: 'resolved', decision, resolvedBy: adminId, resolvedAt: Date.now() })
    audit(adminId, `report.${action}`, 'report', id, `target=${targetId} reason=${reason}`)
    // 通知通话双方处理结果。在"决定变化"时通知（含从旧 /resolve 的无 decision 态 → 有 decision），
    // 这样先 /resolve 再 /moderate 封禁时被举报人仍能收到"账号已被封禁"，而非停留在无内容的"已处理"（见复审 NOTIFY-MODERATE）。
    if (updated && (report.status !== 'resolved' || report.decision !== decision)) notifyReportResolved(updated)
    return { report: updated, decision }
  })

  // 全站绑定关系（盲人 ↔ 协助者/亲友）总览：解析双方显示名与角色，便于排查"加不上人/紧急联系人"等问题。
  app.get('/api/admin/links', adminOnly, async () => {
    const roleOf = (id: string) => store.findById(id)?.role ?? null
    return {
      links: store.allLinks().map((l) => ({
        id: l.id,
        ownerId: l.ownerId,
        ownerName: nameOf(l.ownerId),
        ownerRole: roleOf(l.ownerId),
        memberId: l.memberId,
        memberName: nameOf(l.memberId),
        memberRole: roleOf(l.memberId),
        relation: l.relation,
        isEmergency: l.isEmergency,
        status: l.status ?? 'accepted',
        createdAt: l.createdAt,
      })),
    }
  })

  // 全站通话记录（最近 N 条，时间倒序）：解析主叫/被叫显示名，便于审核滥用与排障。
  app.get('/api/admin/calls', adminOnly, async (req) => {
    const q = req.query as { limit?: string }
    const limit = Math.min(Math.max(Number.parseInt(q.limit ?? '200', 10) || 200, 1), 500)
    return {
      calls: store.allCallRecords(limit).map((c) => ({
        id: c.id,
        callId: c.callId,
        callerId: c.callerId,
        callerName: nameOf(c.callerId),
        calleeId: c.calleeId,
        calleeName: nameOf(c.calleeId),
        status: c.status,
        emergency: c.emergency ?? false, // 紧急求助(SOS)呼叫——治理视图须能区分"未接的紧急求助"与日常协助（此前漏，死字段）
        durationSec: c.durationSec ?? null, // 通话时长（秒）：接通并由参与方上报后有；治理视图显示"3:24"
        createdAt: c.createdAt,
      })),
    }
  })

  // 进行中通话实时总览：当前各通话的参与者、角色、已通话时长。供管理员实时监管。
  app.get('/api/admin/calls/active', adminOnly, async () => {
    const now = Date.now()
    const calls = hub ? hub.activeCalls() : []
    return {
      nowMs: now,
      calls: calls.map((c) => ({
        callId: c.callId,
        startedAt: c.startedAt,
        durationSec: Math.max(0, Math.floor((now - c.startedAt) / 1000)),
        hasAdminObserver: c.hasAdminObserver,
        members: c.members.map((m) => ({
          userId: m.userId,
          role: m.role,
          name: nameOf(m.userId),
          online: presence.isAvailable(m.userId, now),
        })),
      })),
    }
  })

  // 强制结束某通话（违规处置）：向房间各端推 end，双方正常收线。入审计。
  app.post('/api/admin/calls/:callId/end', adminOnly, async (req, reply) => {
    const callId = (req.params as { callId: string }).callId
    const ended = callControl ? callControl.endCall(callId, req.user!.sub) : 0
    if (ended === 0) return reply.code(404).send({ error: 'not_active' })
    audit(req.user!.sub, 'call.forceEnd', 'call', callId, `ended ${ended} endpoint(s)`)
    return { ok: true, ended }
  })

  // 全站拉黑记录（时间倒序）：解析拉黑方/被拉黑方显示名，便于排查"求助队列里看不到某人/被对方屏蔽"等问题。
  app.get('/api/admin/blocks', adminOnly, async () => {
    return {
      blocks: store.allBlocks().map((b) => ({
        id: b.id,
        blockerId: b.blockerId,
        blockerName: nameOf(b.blockerId),
        blockedId: b.blockedId,
        blockedName: nameOf(b.blockedId),
        createdAt: b.createdAt,
      })),
    }
  })

  // —— 账号支持操作（客服）——
  // 人工标记/撤销邮箱已验证：用户邮箱收不到验证码但已人工核实身份时，管理员代为标记，避免卡在"未验证"。
  const verifyEmailSchema = z.object({ verified: z.boolean() })
  app.post('/api/admin/users/:id/verify-email', adminOnly, async (req, reply) => {
    const parsed = verifyEmailSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const id = (req.params as { id: string }).id
    const target = store.findById(id)
    if (!target) return reply.code(404).send({ error: 'not_found' })
    if (!target.email) return reply.code(400).send({ error: 'no_email' }) // 无邮箱可标记，避免产生"已验证却无邮箱"的脏态
    const updated = store.updateUser(id, { emailVerified: parsed.data.verified })
    audit(req.user!.sub, parsed.data.verified ? 'user.verifyEmail' : 'user.unverifyEmail', 'user', id)
    return { user: publicUser(updated!), emailVerified: !!updated!.emailVerified }
  })

  // 解绑 Apple：用户换 Apple ID / 误绑他人 Apple 账号时清除绑定，使其可重新用正确的 Apple 账号绑定。
  app.post('/api/admin/users/:id/unlink-apple', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const target = store.findById(id)
    if (!target) return reply.code(404).send({ error: 'not_found' })
    if (!target.appleSub) return reply.code(400).send({ error: 'not_linked' })
    const updated = store.updateUser(id, { appleSub: undefined })
    audit(req.user!.sub, 'user.unlinkApple', 'user', id)
    notifyAccountSecurity(store, push, target, 'admin_apple_unlinked') // 透明告知本人 + 侦测被盗管理员账号借此接管
    return { user: publicUser(updated!), appleLinked: !!updated!.appleSub }
  })

  // 清除全部 Passkey：用户换设备/丢失设备导致无法用 Passkey 登录时，管理员清空其凭据，使其改用密码登录后重新注册 Passkey。
  app.post('/api/admin/users/:id/clear-passkeys', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const target = store.findById(id)
    if (!target) return reply.code(404).send({ error: 'not_found' })
    const keys = store.passkeysForUser(id)
    for (const k of keys) store.deletePasskey(k.id, id)
    if (keys.length) {
      audit(req.user!.sub, 'user.clearPasskeys', 'user', id, `count=${keys.length}`)
      notifyAccountSecurity(store, push, target, 'admin_passkey_cleared') // 仅真的清了才告警；透明 + 侦测接管
    }
    return { cleared: keys.length, passkeys: store.passkeysForUser(id).length }
  })

  // 强制下线：递增 tokenVersion 使已签发的 access token 立即失效，并撤销全部 refresh token（疑似盗号/客服请求时用）。
  app.post('/api/admin/users/:id/force-logout', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const target = store.findById(id)
    if (!target) return reply.code(404).send({ error: 'not_found' })
    const updated = severSessions(id, target.tokenVersion ?? 0)
    audit(req.user!.sub, 'user.forceLogout', 'user', id)
    return { user: publicUser(updated!), tokenVersion: updated!.tokenVersion ?? 0 }
  })

  // —— 编辑用户资料（管理员对每个字段的直接控制）——
  // 角色/状态仍走各自带"最后管理员"保护的专用端点，不在此重复，避免绕过防锁死。
  const patchSchema = z.object({
    displayName: z.string().trim().min(1).max(64),
    username: z.string().trim().min(3).max(32),
    email: z.string().email().max(254).nullable(),       // null = 清除邮箱
    phone: z.string().trim().min(6).max(20).nullable(),  // null = 清除手机号
    language: z.string().trim().min(2).max(8).nullable(),
    clearAvatar: z.boolean(),
  }).partial()
  app.patch('/api/admin/users/:id', adminOnly, async (req, reply) => {
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const id = (req.params as { id: string }).id
    const u = store.findById(id)
    if (!u) return reply.code(404).send({ error: 'not_found' })
    const d = parsed.data
    if (Object.keys(d).length === 0) return reply.code(400).send({ error: 'invalid_input' })
    const patch: Record<string, unknown> = {}
    const changed: string[] = []
    if (d.displayName !== undefined) { patch.displayName = d.displayName; changed.push('displayName') }
    if (d.username !== undefined) {
      if (!/^[A-Za-z0-9_.-]+$/.test(d.username)) return reply.code(400).send({ error: 'invalid_username' })
      const taken = store.findByUsername(d.username)
      if (taken && taken.id !== id) return reply.code(409).send({ error: 'username_taken' })
      patch.username = d.username; patch.usernameCustomized = true; changed.push('username')
    }
    if (d.email !== undefined) {
      if (d.email === null) { patch.email = undefined; patch.emailVerified = undefined; changed.push('email:cleared') }
      else {
        const norm = d.email.trim().toLowerCase()
        const taken = store.findByEmail(norm)
        if (taken && taken.id !== id) return reply.code(409).send({ error: 'email_taken' })
        patch.email = norm; patch.emailVerified = false; changed.push('email') // 改邮箱即视为未验证，需另行标记/验证
      }
    }
    if (d.phone !== undefined) {
      if (d.phone === null) { patch.phone = undefined; changed.push('phone:cleared') }
      else {
        const np = normalizePhone(d.phone)
        if (!np) return reply.code(400).send({ error: 'invalid_phone' })
        const taken = store.findByPhone(np)
        if (taken && taken.id !== id) return reply.code(409).send({ error: 'phone_taken' })
        patch.phone = np; changed.push('phone')
      }
    }
    if (d.language !== undefined) { patch.language = d.language ?? undefined; changed.push('language') }
    if (d.clearAvatar === true) { patch.avatar = undefined; changed.push('avatar:cleared') }
    if (changed.length === 0) return reply.code(400).send({ error: 'invalid_input' })
    const updated = store.updateUser(id, patch)
    audit(req.user!.sub, 'user.edit', 'user', id, changed.join(', '))
    // 管理员改了**登录标识**(邮箱/手机号/用户名，含清除)→ 预警本人（透明 + 侦测被盗管理员接管）。
    // displayName/语言/头像非登录凭据，不报。多字段一次改也只发一条（避免刷屏）。
    const identifierChanged = changed.some((c) => c.startsWith('email') || c.startsWith('phone') || c === 'username')
    if (identifierChanged) notifyAccountSecurity(store, push, u, 'admin_identifier_changed')
    return { user: publicUser(updated!) }
  })

  // —— 单用户功能覆盖（对某个用户单独关停某功能；精准处置滥用者，不波及全站）——
  // body.overrides：某键 false=对该用户强制关；true/null=清除覆盖（随全站）。逐键合并。
  const featuresPatchSchema = z.object({
    overrides: z.record(z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]), z.boolean().nullable()),
  })
  app.put('/api/admin/users/:id/features', adminOnly, async (req, reply) => {
    const parsed = featuresPatchSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const id = (req.params as { id: string }).id
    const target = store.findById(id)
    if (!target) return reply.code(404).send({ error: 'not_found' })
    const next: Partial<Record<FeatureKey, boolean>> = { ...(target.featureOverrides ?? {}) }
    const changed: string[] = []
    for (const [k, v] of Object.entries(parsed.data.overrides) as [FeatureKey, boolean | null][]) {
      if (v === false) { next[k] = false; changed.push(`${k}:off`) }
      else { delete next[k]; changed.push(`${k}:clear`) } // true/null = 跟随全站
    }
    const overrides = Object.keys(next).length ? next : undefined
    const updated = store.updateUser(id, { featureOverrides: overrides })
    audit(req.user!.sub, 'user.features', 'user', id, changed.join(', '))
    return { user: publicUser(updated!), featureOverrides: updated!.featureOverrides ?? {} }
  })

  // —— 管理员代设密码（客服找回；setupVersion 递增使旧令牌失效并撤销会话）——
  const resetPwSchema = z.object({ newPassword: z.string().min(1).max(128) }) // 强度校验在 handler（passwordPolicy 单点）
  app.post('/api/admin/users/:id/reset-password', adminOnly, async (req, reply) => {
    const parsed = resetPwSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const id = (req.params as { id: string }).id
    const target = store.findById(id)
    if (!target) return reply.code(404).send({ error: 'not_found' })
    // 口令策略含上下文相似（代设也不得用该用户的用户名/邮箱当密码）——先取到 target 才有身份字段。
    const pwErr = passwordPolicyError(parsed.data.newPassword, { username: target.username, email: target.email })
    if (pwErr) return reply.code(400).send({ error: pwErr })
    severSessions(id, target.tokenVersion ?? 0, { passwordHash: hashPassword(parsed.data.newPassword) }) // 改密即撤销所有会话
    audit(req.user!.sub, 'user.resetPassword', 'user', id)
    // 透明告知本人（in-app + best-effort 推送；severSessions 不清推送订阅，故告警仍能触达被登出的设备）+ 侦测
    // 被盗管理员账号借代设密码接管受害者。越勿扰（security_*，见 quietHours）。
    notifyAccountSecurity(store, push, target, 'admin_password_reset')
    return { ok: true }
  })

  // —— 删除用户（高危）：级联清绑定/Passkey/会话，含"不能删自己/唯一活跃管理员"保护 ——
  app.delete('/api/admin/users/:id', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    if (id === req.user!.sub) return reply.code(400).send({ error: 'cannot_delete_self' })
    const target = store.findById(id)
    if (!target) return reply.code(404).send({ error: 'not_found' })
    if (target.role === 'admin' && target.status === 'active' && activeAdminCount() <= 1) {
      return reply.code(400).send({ error: 'last_admin_protected' })
    }
    cascadeDeleteUser(store, id) // 级联清群/消息/绑定/Passkey/会话（保留审核与审计记录）
    callControl?.disconnectUser(id) // 删号即踢在线 /ws（与封禁 severSessions 同口径，删号此前漏了，见对抗复审）
    audit(req.user!.sub, 'user.delete', 'user', id, `username=${target.username}`)
    return { ok: true }
  })

  // —— 审计日志（不可抵赖）——
  // 后台所有有副作用的操作（改角色/封禁/审核处置/改配置等）的时间倒序流水，解析操作管理员显示名。
  app.get('/api/admin/audit', adminOnly, async (req) => {
    const q = req.query as { limit?: string }
    const limit = Math.min(Math.max(Number.parseInt(q.limit ?? '200', 10) || 200, 1), 1000)
    return {
      entries: store.allAuditEntries(limit).map((e) => ({
        ...e,
        adminName: nameOf(e.adminId),
      })),
    }
  })

  // —— 全站运行配置（管理员可控开关）——
  app.get('/api/admin/config', adminOnly, async () => ({ config: store.getAppConfig() }))

  app.put('/api/admin/config', adminOnly, async (req, reply) => {
    const parsed = configSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const data = parsed.data
    // 拒绝空补丁：任何一个可改区块都没有就 400。
    // requireVerification 也必须计入——否则单独 {requireVerification} 补丁（独立开关 KYC 门禁、不改其它配置）
    // 会被误判为空补丁而 400，管理员无法单独切换实名门禁。
    const nonEmpty = (o?: object) => o && Object.keys(o).length > 0
    if (data.registrationEnabled === undefined && data.requireVerification === undefined && !nonEmpty(data.features) &&
        !nonEmpty(data.announcement) && !nonEmpty(data.maintenance) && !nonEmpty(data.contentFilter)) {
      return reply.code(400).send({ error: 'invalid_input' })
    }
    const next = store.setAppConfig(data)
    audit(req.user!.sub, 'config.update', 'config', 'app', JSON.stringify(data))
    return { config: next }
  })
}
