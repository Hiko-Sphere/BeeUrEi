import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type Role, type User, type AdminAuditEntry, type FeatureKey, FEATURE_KEYS, publicUser } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { hashPassword } from '../auth/passwords'
import { normalizePhone } from '../auth/apple'
import { cascadeDeleteUser } from '../db/cascade'
import type { PresenceRegistry } from '../assist/presence'
import { type SignalingHub } from '../signaling/hub'
import { type CallControlBridge } from '../signaling/callControl'
import { type PushSender, NoopPushSender } from '../push/apns'
import { pushLang, pushStrings } from '../push/pushStrings'
import { notifyUser } from '../notifications/notify'
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

const SERVER_VERSION = '0.1.0'
const START_MS = Date.now()

export function registerAdminRoutes(app: FastifyInstance, store: Store, presence: PresenceRegistry, hub?: SignalingHub, callControl?: CallControlBridge, push: PushSender = new NoopPushSender()): void {
  const adminOnly = { preHandler: requireAuth(['admin']) }
  // 当前活跃管理员数（用于"最后一名管理员"保护，防把后台锁死）。
  const activeAdminCount = () => store.allUsers().filter((u) => u.role === 'admin' && u.status === 'active').length
  // 强制下线一名用户：撤销全部 refresh token + 递增 tokenVersion（在线 access token 立即失效、被登出会话即时撤销）。
  // 封禁(单/批量/举报处置)、force-logout、代设密码共用此原语——把"必须同时撤销会话"收敛一处，杜绝各自 inline 的漂移
  // （曾致单用户封禁只改 status 不撤会话，见修复）。patch 承载 status/passwordHash 等附加变更；tokenVersion 恒在 patch 之后，不可被覆盖。
  const severSessions = (id: string, currentTv: number, patch: Partial<User> = {}) => {
    store.deleteRefreshTokensForUser(id)
    return store.updateUser(id, { ...patch, tokenVersion: currentTv + 1 })
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
    return {
      users: { total: users.length, active, disabled, byRole },
      online: { total: online.size, helpers: onlineHelpers },
      reports: { open: openReports, total: reports.length },
      recordings: { total: store.allRecordings().length, config: store.getRecordingConfig() },
      verifications: { pending: store.countPendingVerifications(), total: store.allVerifications().length },
      growth: { newUsers7d, newUsers30d, trend },
      version: SERVER_VERSION,
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
      plain = openSealed(ref.sealed, readKycBlob(ref.blobId), { submissionId: v.id, kind: kind as KycDocKind })
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
        if (action === 'disable') { severSessions(id, target.tokenVersion ?? 0, { status: 'disabled' }); audit(adminId, 'user.disable', 'user', id, 'bulk') }
        else if (action === 'enable') { store.updateUser(id, { status: 'active' }); audit(adminId, 'user.enable', 'user', id, 'bulk') }
        else if (action === 'role') { store.updateUser(id, { role: role as Role }); audit(adminId, 'user.role', 'user', id, `bulk → ${role}`) }
        else if (action === 'delete') { cascadeDeleteUser(store, id); audit(adminId, 'user.delete', 'user', id, `bulk username=${target.username}`) }
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
    const u = store.findById(id)
    if (!u) return reply.code(404).send({ error: 'not_found' })
    const now = Date.now()
    const allReports = store.allReports()
    const involving = store.blocksInvolving(id)
    const data = {
      exportedAt: now,
      exportedByAdminId: req.user!.sub,
      note: 'Chat message bodies are intentionally excluded to preserve conversation privacy; admins do not read messages. Tokens and password hashes are never exported.',
      profile: {
        id: u.id, username: u.username, displayName: u.displayName, role: u.role, status: u.status,
        createdAt: u.createdAt, language: u.language ?? null,
        email: u.email ?? null, emailVerified: !!u.emailVerified, phone: u.phone ?? null,
        appleLinked: !!u.appleSub, usernameCustomized: !!u.usernameCustomized,
        legalConsentVersion: u.legalConsentVersion ?? null, legalConsentAt: u.legalConsentAt ?? null,
        hasAvatar: !!u.avatar, featureOverrides: u.featureOverrides ?? {},
      },
      familyLinks: [
        ...store.linksByOwner(id).map((l) => ({ direction: 'owner', other: nameOf(l.memberId), relation: l.relation, isEmergency: l.isEmergency, status: l.status ?? 'accepted', createdAt: l.createdAt })),
        ...store.linksByMember(id).map((l) => ({ direction: 'member', other: nameOf(l.ownerId), relation: l.relation, isEmergency: l.isEmergency, status: l.status ?? 'accepted', createdAt: l.createdAt })),
      ],
      blocks: {
        blocking: involving.filter((b) => b.blockerId === id).map((b) => ({ other: nameOf(b.blockedId), createdAt: b.createdAt })),
        blockedBy: involving.filter((b) => b.blockedId === id).map((b) => ({ other: nameOf(b.blockerId), createdAt: b.createdAt })),
      },
      reports: {
        filedByUser: allReports.filter((r) => r.reporterId === id).map((r) => ({ target: nameOf(r.targetUserId), reason: r.reason, status: r.status, decision: r.decision ?? null, createdAt: r.createdAt })),
        againstUser: allReports.filter((r) => r.targetUserId === id).map((r) => ({ reporter: nameOf(r.reporterId), reason: r.reason, status: r.status, decision: r.decision ?? null, createdAt: r.createdAt })),
      },
      warnings: store.warningsForUser(id).map((w) => ({ reason: w.reason, byAdmin: nameOf(w.byAdminId), at: w.at })),
      recordings: store.allRecordings().filter((r) => r.ownerId === id).map((r) => ({ callId: r.callId, reason: r.reason, recordedAt: r.recordedAt })),
      callRecords: store.callRecordsForUser(id, 1000).map((c) => ({ direction: c.callerId === id ? 'outgoing' : 'incoming', peer: nameOf(c.callerId === id ? c.calleeId : c.callerId), status: c.status, createdAt: c.createdAt })),
      passkeys: store.passkeysForUser(id).map((p) => ({ deviceName: p.deviceName ?? null, createdAt: p.createdAt })),
      activeSessions: store.countSessionsForUser(id, now),
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
    if (target.role === 'admin' && parsed.data.status === 'disabled' && activeAdminCount() <= 1) {
      return reply.code(400).send({ error: 'last_admin_protected' })
    }
    // 封禁即吊销会话（severSessions 与批量封禁/force-logout 同口径：删 refresh + 递增 tokenVersion，
    // 使在线 access token 立即失效、解封后须重新登录）。解封(enable)只改 status、不动会话。
    const updated = parsed.data.status === 'disabled'
      ? severSessions(id, target.tokenVersion ?? 0, { status: 'disabled' })
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
      severSessions(targetId, target.tokenVersion ?? 0, { status: 'disabled' })
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
    return { user: publicUser(updated!), appleLinked: !!updated!.appleSub }
  })

  // 清除全部 Passkey：用户换设备/丢失设备导致无法用 Passkey 登录时，管理员清空其凭据，使其改用密码登录后重新注册 Passkey。
  app.post('/api/admin/users/:id/clear-passkeys', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const target = store.findById(id)
    if (!target) return reply.code(404).send({ error: 'not_found' })
    const keys = store.passkeysForUser(id)
    for (const k of keys) store.deletePasskey(k.id, id)
    if (keys.length) audit(req.user!.sub, 'user.clearPasskeys', 'user', id, `count=${keys.length}`)
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
  const resetPwSchema = z.object({ newPassword: z.string().min(6).max(128) })
  app.post('/api/admin/users/:id/reset-password', adminOnly, async (req, reply) => {
    const parsed = resetPwSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const id = (req.params as { id: string }).id
    const target = store.findById(id)
    if (!target) return reply.code(404).send({ error: 'not_found' })
    severSessions(id, target.tokenVersion ?? 0, { passwordHash: hashPassword(parsed.data.newPassword) }) // 改密即撤销所有会话
    audit(req.user!.sub, 'user.resetPassword', 'user', id)
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
