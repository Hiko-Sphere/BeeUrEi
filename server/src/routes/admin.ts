import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store, publicUser } from '../db/store'
import { requireAuth } from '../auth/rbac'

const statusSchema = z.object({ status: z.enum(['active', 'disabled']) })

export function registerAdminRoutes(app: FastifyInstance, store: Store): void {
  const adminOnly = { preHandler: requireAuth(['admin']) }

  // 列出所有用户。
  app.get('/api/admin/users', adminOnly, async () => {
    return { users: store.allUsers().map(publicUser) }
  })

  // 封禁 / 解封（设置 status）。
  app.post('/api/admin/users/:id/status', adminOnly, async (req, reply) => {
    const parsed = statusSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const id = (req.params as { id: string }).id
    const updated = store.updateUser(id, { status: parsed.data.status })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    return { user: publicUser(updated) }
  })

  // 举报列表。
  app.get('/api/admin/reports', adminOnly, async () => {
    return { reports: store.allReports() }
  })

  // 处理举报（标记已解决）。
  app.post('/api/admin/reports/:id/resolve', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const updated = store.updateReport(id, { status: 'resolved' })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    return { report: updated }
  })
}
