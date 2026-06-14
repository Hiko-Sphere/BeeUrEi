import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type Recording } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { sweepExpiredRecordings } from '../recording/retention'
import { removeMediaFile } from '../media/storage'
import { RecordingConsentRegistry } from '../recording/consentRegistry'
import { type PendingCallRegistry } from '../assist/pendingCalls'
import { type OpenHelpRegistry } from '../assist/openHelp'

const configSchema = z.object({
  enabled: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  requireConsent: z.boolean().optional(),
})

const createSchema = z.object({
  callId: z.string().min(1),
  reason: z.string().max(200).optional(),
  mediaId: z.string().min(1).optional(), // 录制实体（先经 /api/media 上传 .mov 拿到），可选
})

const consentSchema = z.object({ callId: z.string().min(1), granted: z.boolean() })

export function registerRecordingRoutes(app: FastifyInstance, store: Store, consent: RecordingConsentRegistry,
                                        pendingCalls: PendingCallRegistry, openHelp: OpenHelpRegistry): void {
  const adminOnly = { preHandler: requireAuth(['admin']) }

  // 被录方授予/撤回录制同意（服务端权威）：录制登记时据此核验，不信任发起者自报的同意。
  app.post('/api/recordings/consent', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = consentSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    // 只有该通话的**真实参与者**才能就此 callId 授予同意——否则任意登录用户可为自己不在的通话伪造同意，
    // 让发起者+串通的第三方在被录方不知情下录制（见录制评审 high）。与 ws.ts join 同一参与权校验。
    // 在途登记(pendingCalls 180s/openHelp 4h)覆盖通话早期；亲友通话另有持久 CallRecord 兜底，
    // 使"通话进行 >3 分钟后才点录制"也能正确校验参与权（不被在途登记过期误拒）。
    const now = Date.now()
    const me = req.user!.sub
    const callId = parsed.data.callId
    const inRegistry = (pendingCalls.participants(callId, now) ?? openHelp.participants(callId, now))?.includes(me) ?? false
    const inCallRecord = store.callRecordsForUser(me).some((r) => r.callId === callId)
    if (!inRegistry && !inCallRecord) {
      return reply.code(403).send({ error: 'not_a_participant' })
    }
    if (parsed.data.granted) consent.grant(parsed.data.callId, req.user!.sub, now)
    else consent.revoke(parsed.data.callId, req.user!.sub)
    return { ok: true }
  })

  app.get('/api/recordings/config', adminOnly, async () => store.getRecordingConfig())

  app.put('/api/recordings/config', adminOnly, async (req, reply) => {
    const parsed = configSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    return store.setRecordingConfig(parsed.data)
  })

  // 创建一条录制元数据。默认关闭；开启后仍需满足知情同意。
  app.post('/api/recordings', { preHandler: requireAuth() }, async (req, reply) => {
    const cfg = store.getRecordingConfig()
    if (!cfg.enabled) return reply.code(403).send({ error: 'recording_disabled' })
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const owner = req.user!
    // 知情同意**服务端权威**：consentBy 由服务端从同意登记表取（被录方经鉴权端点亲自授予），
    // 而非信任发起者自报——杜绝被改造客户端伪造对端同意。要求至少有一名非发起者的有效同意。
    const consenters = consent.consenters(parsed.data.callId, owner.sub, Date.now())
    if (cfg.requireConsent && consenters.length === 0) {
      return reply.code(400).send({ error: 'consent_required' })
    }
    // mediaId 必须是上传者本人的媒体（防把他人媒体挂到自己的录制上）。
    if (parsed.data.mediaId) {
      const media = store.findMedia(parsed.data.mediaId)
      if (!media || media.ownerId !== owner.sub) return reply.code(400).send({ error: 'invalid_media' })
    }
    const rec: Recording = {
      id: randomUUID(),
      callId: parsed.data.callId,
      ownerId: owner.sub,
      consentBy: consenters, // 服务端核验后的真实同意者
      reason: parsed.data.reason ?? '',
      recordedAt: Date.now(),
      mediaId: parsed.data.mediaId,
    }
    store.createRecording(rec)
    return reply.code(201).send({ recording: rec })
  })

  // 列出录制（先清过期项：删元数据 + 级联删媒体文件）。
  app.get('/api/recordings', adminOnly, async () => {
    const purged = sweepExpiredRecordings(store, Date.now())
    return { recordings: store.allRecordings(), purged }
  })

  app.delete('/api/recordings/:id', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const rec = store.findRecording(id)
    if (!rec) return reply.code(404).send({ error: 'not_found' })
    if (rec.mediaId) { removeMediaFile(rec.mediaId); store.deleteMedia(rec.mediaId) } // 级联删媒体
    store.deleteRecording(id)
    return reply.code(204).send()
  })
}
