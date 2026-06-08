import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type Report } from '../db/store'
import { requireAuth } from '../auth/rbac'

const createReportSchema = z.object({
  targetUserId: z.string().min(1),
  callId: z.string().optional(),
  reason: z.string().min(1).max(500),
})

export function registerReportRoutes(app: FastifyInstance, store: Store): void {
  // 任何登录用户可举报（通话后一键举报）。
  app.post('/api/reports', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = createReportSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const reporter = req.user!
    // 去重：同一举报人对同一对象已有未处理举报则不重复创建（防刷）。
    const existing = store.allReports().find(
      (r) => r.reporterId === reporter.sub && r.targetUserId === parsed.data.targetUserId && r.status === 'open',
    )
    if (existing) return reply.code(200).send({ report: existing, deduped: true })
    const report: Report = {
      id: randomUUID(),
      reporterId: reporter.sub,
      targetUserId: parsed.data.targetUserId,
      callId: parsed.data.callId,
      reason: parsed.data.reason,
      status: 'open',
      createdAt: Date.now(),
    }
    store.createReport(report)
    return reply.code(201).send({ report })
  })
}
