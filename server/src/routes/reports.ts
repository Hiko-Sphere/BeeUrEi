import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type Report } from '../db/store'
import { requireAuth } from '../auth/rbac'

const createReportSchema = z.object({
  targetUserId: z.string().min(1),
  callId: z.string().optional(),
  reason: z.string().min(1).max(500),
  evidenceRecordingId: z.string().min(1).optional(), // 附通话录制作为证据（举报人须为该录制参与方）
})

export function registerReportRoutes(app: FastifyInstance, store: Store): void {
  // 任何登录用户可举报（通话后一键举报）。
  app.post('/api/reports', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = createReportSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const reporter = req.user!
    // 证据校验：附带的录制必须存在，且举报人**就是该录制的拥有者**（录制者本人）——
    // 仅拥有者可把自己的录制作为证据提出。否则非拥有者参与方可把他人（甚至已软删除）的录制拖入
    // 无限期取证留存、绕过拥有者的删除控制、并把其位置等元数据暴露给管理员（见复审 EVIDENCE-OWNER）。
    let evidenceRecordingId: string | undefined
    if (parsed.data.evidenceRecordingId) {
      const rec = store.findRecording(parsed.data.evidenceRecordingId)
      if (!rec || rec.ownerId !== reporter.sub) return reply.code(400).send({ error: 'invalid_evidence' })
      evidenceRecordingId = rec.id
    }
    // 去重：同一举报人对同一对象已有未处理举报则不重复创建（防刷）。
    const existing = store.allReports().find(
      (r) => r.reporterId === reporter.sub && r.targetUserId === parsed.data.targetUserId && r.status === 'open',
    )
    if (existing) {
      // 既有举报尚无证据 → 补挂本次证据。
      if (evidenceRecordingId && !existing.evidenceRecordingId) {
        const updated = store.updateReport(existing.id, { evidenceRecordingId })
        return reply.code(200).send({ report: updated ?? existing, deduped: true })
      }
      // 本次带了**不同的**新证据：不可被去重静默吞掉（否则该证据丢失且会被留存清理删除，见复审 EVIDENCE-DEDUP）——
      // 单独建一条带该证据的举报（证据型举报不视为刷量），从而被引用保护、可被管理员看到。
      if (evidenceRecordingId && existing.evidenceRecordingId && existing.evidenceRecordingId !== evidenceRecordingId) {
        // 落入下方创建分支。
      } else {
        return reply.code(200).send({ report: existing, deduped: true })
      }
    }
    const report: Report = {
      id: randomUUID(),
      reporterId: reporter.sub,
      targetUserId: parsed.data.targetUserId,
      callId: parsed.data.callId,
      reason: parsed.data.reason,
      status: 'open',
      createdAt: Date.now(),
      evidenceRecordingId,
    }
    store.createReport(report)
    return reply.code(201).send({ report })
  })
}
