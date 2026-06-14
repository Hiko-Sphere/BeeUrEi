import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type Role, type AdminAuditEntry, publicUser } from '../db/store'
import { requireAuth } from '../auth/rbac'
import type { PresenceRegistry } from '../assist/presence'

const statusSchema = z.object({ status: z.enum(['active', 'disabled']) })
const roleSchema = z.object({ role: z.enum(['blind', 'helper', 'family', 'admin', 'developer']) })
// 审核处置阶梯：忽略 / 警告（不封）/ 暂停（封禁+强制下线）/ 封禁（封禁+强制下线，记为最重处置）。
const moderateSchema = z.object({
  action: z.enum(['dismiss', 'warn', 'suspend', 'ban']),
  reason: z.string().trim().min(1).max(1000),
})
const configSchema = z.object({ registrationEnabled: z.boolean() })

const SERVER_VERSION = '0.1.0'
const START_MS = Date.now()

export function registerAdminRoutes(app: FastifyInstance, store: Store, presence: PresenceRegistry): void {
  const adminOnly = { preHandler: requireAuth(['admin']) }
  // 当前活跃管理员数（用于"最后一名管理员"保护，防把后台锁死）。
  const activeAdminCount = () => store.allUsers().filter((u) => u.role === 'admin' && u.status === 'active').length
  const nameOf = (id: string) => store.findById(id)?.displayName ?? '—'
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
      growth: { newUsers7d, newUsers30d, trend },
      version: SERVER_VERSION,
      uptimeSeconds: Math.floor((now - START_MS) / 1000),
      nowMs: now,
    }
  })

  // 列出所有用户（在 publicUser 基础上补 createdAt/语言/在线/是否绑邮箱手机，便于后台表格；不外泄具体邮箱手机）。
  app.get('/api/admin/users', adminOnly, async () => {
    const now = Date.now()
    return {
      users: store.allUsers().map((u) => ({
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

  // 单个用户详情（含邮箱/手机/绑定关系/拉黑数/近期通话）——仅管理员审核可见。
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
    return {
      user: {
        ...publicUser(u),
        createdAt: u.createdAt,
        language: u.language ?? null,
        email: u.email ?? null,
        emailVerified: !!u.emailVerified,
        phone: u.phone ?? null,
        appleLinked: !!u.appleSub,
        passkeys: store.passkeysForUser(id).length,
        online: presence.isAvailable(id, now),
      },
      links,
      blockedCount: store.blocksInvolving(id).length,
      recentCalls,
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
    const updated = store.updateUser(id, { status: parsed.data.status })
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
    const updated = store.updateReport(id, { status: 'resolved', resolvedBy: req.user!.sub, resolvedAt: Date.now() })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    audit(req.user!.sub, 'report.resolve', 'report', id)
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
      store.deleteRefreshTokensForUser(targetId)
      store.updateUser(targetId, { status: 'disabled', tokenVersion: (target.tokenVersion ?? 0) + 1 })
    }
    const updated = store.updateReport(id, { status: 'resolved', decision, resolvedBy: adminId, resolvedAt: Date.now() })
    audit(adminId, `report.${action}`, 'report', id, `target=${targetId} reason=${reason}`)
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
    store.deleteRefreshTokensForUser(id)
    const updated = store.updateUser(id, { tokenVersion: (target.tokenVersion ?? 0) + 1 })
    audit(req.user!.sub, 'user.forceLogout', 'user', id)
    return { user: publicUser(updated!), tokenVersion: updated!.tokenVersion ?? 0 }
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
    const parsed = configSchema.partial().safeParse(req.body)
    if (!parsed.success || Object.keys(parsed.data).length === 0) return reply.code(400).send({ error: 'invalid_input' })
    const next = store.setAppConfig(parsed.data)
    audit(req.user!.sub, 'config.update', 'config', 'app', JSON.stringify(parsed.data))
    return { config: next }
  })
}
