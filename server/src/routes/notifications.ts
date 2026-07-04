import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { localMinuteOfDay } from '../notifications/quietHours'

// 勿扰时段配置：分钟-of-day [0,1439] + IANA 时区。start>end 表跨午夜（22:00→07:00）。
const quietHoursSchema = z.object({
  enabled: z.boolean(),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
  tz: z.string().trim().min(1).max(64),
})

/// 站内通知收件箱（持久化、可回看）：用户读取自己的通知、标记已读。
/// 严格作用域到 req.user.sub——通知行只对其收件人可见。
export function registerNotificationRoutes(app: FastifyInstance, store: Store): void {
  // 我的通知（时间倒序）+ 未读数。
  app.get('/api/notifications', { preHandler: requireAuth() }, async (req) => {
    const me = req.user!.sub
    return { notifications: store.notificationsForUser(me), unread: store.unreadNotificationCount(me) }
  })

  // 标记单条已读（仅本人；不存在/非本人均静默 204，避免探测他人通知存在性）。
  app.post('/api/notifications/:id/read', { preHandler: requireAuth() }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    store.markNotificationRead(id, req.user!.sub)
    return reply.code(204).send()
  })

  // 全部标记已读。
  app.post('/api/notifications/read-all', { preHandler: requireAuth() }, async (req) => {
    const n = store.markAllNotificationsRead(req.user!.sub)
    return { marked: n }
  })

  // 勿扰时段（Do-Not-Disturb）：读取/设置。仅抑制**软通知**的推送横幅（站内通知照常持久化）；
  // 紧急告警/来电/SOS 走独立扇出、绝不受影响。仅作用于本人。
  app.get('/api/notifications/quiet-hours', { preHandler: requireAuth() }, async (req) => {
    const me = store.findById(req.user!.sub)
    return { quietHours: me?.quietHours ?? null }
  })

  app.put('/api/notifications/quiet-hours', { preHandler: requireAuth(),
                                              config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = quietHoursSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    // 校验 tz 是真实 IANA 时区（Intl 能解析）——否则勿扰判定恒 fail-open（等于设了没用），须早拒并明确报错。
    if (localMinuteOfDay(Date.now(), parsed.data.tz) == null) return reply.code(400).send({ error: 'invalid_timezone' })
    const updated = store.updateUser(req.user!.sub, { quietHours: parsed.data })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    return { quietHours: updated.quietHours }
  })
}
