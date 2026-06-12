import type { FastifyInstance } from 'fastify'
import { type Store, selfView } from '../db/store'
import { requireAuth } from '../auth/rbac'

export function registerUserRoutes(app: FastifyInstance, store: Store): void {
  app.get('/api/me', { preHandler: requireAuth() }, async (req, reply) => {
    const auth = req.user!
    const full = store.findById(auth.sub)
    if (!full) return reply.code(404).send({ error: 'not_found' })
    // 含本人邮箱/语言/验证状态（D1）+ 是否已注册 passkey（账号页展示/管理）。
    return { user: { ...selfView(full), hasPasskey: store.passkeysForUser(full.id).length > 0 } }
  })
}
