import type { FastifyInstance } from 'fastify'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'

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
}
