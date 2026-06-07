import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type Recording } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { expiredRecordingIds } from '../recording/retention'

const configSchema = z.object({
  enabled: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  requireConsent: z.boolean().optional(),
})

const createSchema = z.object({
  callId: z.string().min(1),
  consentBy: z.array(z.string()).default([]),
  reason: z.string().max(200).optional(),
})

export function registerRecordingRoutes(app: FastifyInstance, store: Store): void {
  const adminOnly = { preHandler: requireAuth(['admin']) }

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
    if (cfg.requireConsent && !parsed.data.consentBy.includes(owner.sub)) {
      return reply.code(400).send({ error: 'consent_required' })
    }
    const rec: Recording = {
      id: randomUUID(),
      callId: parsed.data.callId,
      ownerId: owner.sub,
      consentBy: parsed.data.consentBy,
      reason: parsed.data.reason ?? '',
      recordedAt: Date.now(),
    }
    store.createRecording(rec)
    return reply.code(201).send({ recording: rec })
  })

  // 列出录制（先按保留期清理过期项 → 到期自动删除）。
  app.get('/api/recordings', adminOnly, async () => {
    const cfg = store.getRecordingConfig()
    const expired = expiredRecordingIds(store.allRecordings(), cfg.retentionDays, Date.now())
    for (const id of expired) store.deleteRecording(id)
    return { recordings: store.allRecordings(), purged: expired.length }
  })

  app.delete('/api/recordings/:id', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    if (!store.findRecording(id)) return reply.code(404).send({ error: 'not_found' })
    store.deleteRecording(id)
    return reply.code(204).send()
  })
}
