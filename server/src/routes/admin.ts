import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store, type Role, publicUser } from '../db/store'
import { requireAuth } from '../auth/rbac'
import type { PresenceRegistry } from '../assist/presence'

const statusSchema = z.object({ status: z.enum(['active', 'disabled']) })
const roleSchema = z.object({ role: z.enum(['blind', 'helper', 'family', 'admin', 'developer']) })

const SERVER_VERSION = '0.1.0'
const START_MS = Date.now()

export function registerAdminRoutes(app: FastifyInstance, store: Store, presence: PresenceRegistry): void {
  const adminOnly = { preHandler: requireAuth(['admin']) }
  // 当前活跃管理员数（用于"最后一名管理员"保护，防把后台锁死）。
  const activeAdminCount = () => store.allUsers().filter((u) => u.role === 'admin' && u.status === 'active').length
  const nameOf = (id: string) => store.findById(id)?.displayName ?? '—'

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
    return {
      users: { total: users.length, active, disabled, byRole },
      online: { total: online.size, helpers: onlineHelpers },
      reports: { open: openReports, total: reports.length },
      recordings: { total: store.allRecordings().length, config: store.getRecordingConfig() },
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
    const updated = store.updateUser(id, { role: parsed.data.role as Role })
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
    return { user: publicUser(updated!) }
  })

  // 举报列表（解析举报人/被举报人显示名，便于审核）。
  app.get('/api/admin/reports', adminOnly, async () => {
    return {
      reports: store.allReports().map((r) => ({
        ...r,
        reporterName: store.findById(r.reporterId)?.displayName ?? '未知',
        targetName: store.findById(r.targetUserId)?.displayName ?? '未知',
      })),
    }
  })

  // 处理举报（标记已解决）。
  app.post('/api/admin/reports/:id/resolve', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const updated = store.updateReport(id, { status: 'resolved' })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    return { report: updated }
  })
}
