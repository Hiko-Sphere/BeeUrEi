import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, publicUser } from '../db/store'
import { requireAuth } from '../auth/rbac'

// 按用户名或 userId 拉黑（通话中只有对方 userId）。
const blockSchema = z.object({
  username: z.string().trim().min(1).max(32).optional(),
  userId: z.string().min(1).max(64).optional(),
}).refine((d) => d.username || d.userId, { message: 'username_or_userId_required' })

/// 黑名单：拉黑后双方互不出现在匹配/公开求助队列/来电中（任一方向拉黑都生效）。
export function registerBlockRoutes(app: FastifyInstance, store: Store): void {
  // 拉黑某用户（按用户名）。
  app.post('/api/blocks', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = blockSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const meId = req.user!.sub
    const target = parsed.data.userId ? store.findById(parsed.data.userId) : store.findByUsername(parsed.data.username!)
    if (!target) return reply.code(404).send({ error: 'not_found' })
    if (target.id === meId) return reply.code(400).send({ error: 'cannot_block_self' })
    // 去重：同一方向已拉黑则幂等返回。
    const already = store.blocksInvolving(meId).some((b) => b.blockerId === meId && b.blockedId === target.id)
    if (!already) store.createBlock({ id: randomUUID(), blockerId: meId, blockedId: target.id, createdAt: Date.now() })
    return { ok: true }
  })

  // 我拉黑的人（列表）。
  app.get('/api/blocks', { preHandler: requireAuth() }, async (req) => {
    const meId = req.user!.sub
    const mine = store.blocksInvolving(meId).filter((b) => b.blockerId === meId)
    return {
      blocks: mine.map((b) => {
        const u = store.findById(b.blockedId)
        return { id: b.id, user: u ? publicUser(u) : { id: b.blockedId, username: '?', displayName: '已注销用户', role: 'blind', status: 'disabled' } }
      }),
    }
  })

  // 解除拉黑（仅本人创建的拉黑记录）。
  app.delete('/api/blocks/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const b = store.findBlock(id)
    if (!b || b.blockerId !== req.user!.sub) return reply.code(404).send({ error: 'not_found' })
    store.deleteBlock(id)
    return reply.code(204).send()
  })
}
