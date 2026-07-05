import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type Report } from '../db/store'
import { requireAuth } from '../auth/rbac'

const createReportSchema = z.object({
  targetUserId: z.string().min(1).max(64),
  callId: z.string().max(128).optional(),
  reason: z.string().min(1).max(500),
  evidenceRecordingId: z.string().min(1).max(64).optional(), // 附通话录制作为证据（举报人须为该录制参与方）
})

export function registerReportRoutes(app: FastifyInstance, store: Store): void {
  // 任何登录用户可举报（通话后一键举报）。
  app.post('/api/reports', { preHandler: requireAuth(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = createReportSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const reporter = req.user!
    // 被举报对象须是真实用户、且不能是自己——否则可用伪造/变化的 targetUserId 每次绕过去重(去重按 reporter+target)、
    // 无限灌报(报表长期留存→无界增长 + 管理员队列被刷爆)。配合上面的限流(10/min)双重防刷。
    if (parsed.data.targetUserId === reporter.sub) return reply.code(400).send({ error: 'cannot_report_self' })
    if (!store.findById(parsed.data.targetUserId)) return reply.code(404).send({ error: 'target_not_found' })
    // 证据校验：附带的录制必须存在，且举报人**就是该录制的拥有者**（录制者本人）——
    // 仅拥有者可把自己的录制作为证据提出。否则非拥有者参与方可把他人（甚至已软删除）的录制拖入
    // 无限期取证留存、绕过拥有者的删除控制、并把其位置等元数据暴露给管理员（见复审 EVIDENCE-OWNER）。
    let evidenceRecordingId: string | undefined
    if (parsed.data.evidenceRecordingId) {
      const rec = store.findRecording(parsed.data.evidenceRecordingId)
      if (!rec || rec.ownerId !== reporter.sub) return reply.code(400).send({ error: 'invalid_evidence' })
      // 证据须**确实拍到被举报人**：录制参与者须含 targetUserId（新录制存 participants；老录制回退 ownerId+consentBy
      // 推导，与 recordings.ts 同口径）。否则举报人可拿一段与被举报人无关的通话录制（含**第三方**的音视频/位置
      // 元数据）当证据——把无关第三方的录制暴露给管理员取证留存、并误导处置。延续 EVIDENCE-OWNER 的隐私不变量
      // （无关方录制绝不因举报被拖入留存）：既然录制是同意门控的，target 不在参与者里就意味着这段录制根本没拍到他。
      const parts = rec.participants ?? [rec.ownerId, ...rec.consentBy]
      if (!parts.includes(parsed.data.targetUserId)) return reply.code(400).send({ error: 'invalid_evidence' })
      evidenceRecordingId = rec.id
    }
    // 去重（防刷）：同一举报人对同一对象的**全部**未处理举报——不能只看首条。
    // 否则「已有 E1 证据的举报」在前时，反复提交同一 E2 证据会因首条(E1)不等而每次新建重复举报
    // （EVIDENCE-DEDUP 只挡了首条同证据；非首条同证据漏挡→同一录制被多次留存、刷爆管理员队列）。
    const openReports = store.allReports().filter(
      (r) => r.reporterId === reporter.sub && r.targetUserId === parsed.data.targetUserId && r.status === 'open',
    )
    if (evidenceRecordingId) {
      // 同一证据已有开放举报 → 去重（同一录制不被反复举报刷量/重复取证留存）。
      const sameEvidence = openReports.find((r) => r.evidenceRecordingId === evidenceRecordingId)
      if (sameEvidence) return reply.code(200).send({ report: sameEvidence, deduped: true })
      // 有一条尚无证据的开放举报 → 把首次纯文字举报升级为带证据。
      const noEvidence = openReports.find((r) => !r.evidenceRecordingId)
      if (noEvidence) {
        const updated = store.updateReport(noEvidence.id, { evidenceRecordingId })
        return reply.code(200).send({ report: updated ?? noEvidence, deduped: true })
      }
      // 否则：不同的新证据 → 落入下方创建（证据型举报不视为刷量，须各自留存、可被管理员看到）。
    } else if (openReports.length) {
      // 无证据：已有任意开放举报即去重。
      return reply.code(200).send({ report: openReports[0], deduped: true })
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
