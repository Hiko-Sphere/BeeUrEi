import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { localMinuteOfDay } from '../notifications/quietHours'
import { MUTABLE_CATEGORIES, sanitizeMutedCategories } from '../notifications/notifCategories'

// 勿扰时段配置：分钟-of-day [0,1439] + IANA 时区。start>end 表跨午夜（22:00→07:00）。
const quietHoursSchema = z.object({
  enabled: z.boolean(),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
  tz: z.string().trim().min(1).max(64),
})

// 按类别静音的推送横幅：合法类别仅 social/route/location（危急类不可静音，服务端 notifCategory 已兜底）。
const pushCategoriesSchema = z.object({
  muted: z.array(z.enum(MUTABLE_CATEGORIES)).max(MUTABLE_CATEGORIES.length),
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

  // 删除单条通知（清理收件箱；仅本人）。不存在/非本人均静默 204（幂等 + 不泄露他人通知存在性，与标已读同口径）。
  // 删的是收件箱副本，不影响紧急事件/审计等独立记录。
  app.delete('/api/notifications/:id', { preHandler: requireAuth() }, async (req, reply) => {
    store.deleteNotification((req.params as { id: string }).id, req.user!.sub)
    return reply.code(204).send()
  })

  // 一键清空**已读**通知（保留未读，避免误清尚未看的紧急/求助提醒）。返回清除条数。
  app.post('/api/notifications/clear-read', { preHandler: requireAuth() }, async (req) => {
    const cleared = store.deleteReadNotificationsForUser(req.user!.sub)
    return { cleared }
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

  // 按类别静音推送横幅（与勿扰时段正交）：读取/设置。仅抑制该类**软通知**的推送横幅，站内通知照常持久化。
  // 紧急告警/来电/SOS/安全报到走独立扇出或 notifCategory→null，绝不受影响。仅作用于本人。
  app.get('/api/notifications/push-categories', { preHandler: requireAuth() }, async (req) => {
    const me = store.findById(req.user!.sub)
    return { muted: me?.mutedPushCategories ?? [], available: MUTABLE_CATEGORIES }
  })

  app.put('/api/notifications/push-categories', { preHandler: requireAuth(),
                                                  config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = pushCategoriesSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    // 规整：只留合法类别、去重、稳定序（存储/回传一致；client 传重复或乱序也无所谓）。
    const muted = sanitizeMutedCategories(parsed.data.muted)
    const updated = store.updateUser(req.user!.sub, { mutedPushCategories: muted })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    return { muted: updated.mutedPushCategories ?? [] }
  })
}
