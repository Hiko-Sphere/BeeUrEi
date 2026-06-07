import type { FastifyInstance } from 'fastify'
import { type Store, publicUser } from '../db/store'
import { requireAuth } from '../auth/rbac'

export function registerUserRoutes(app: FastifyInstance, store: Store): void {
  app.get('/api/me', { preHandler: requireAuth() }, async (req, reply) => {
    const auth = req.user!
    const full = store.findById(auth.sub)
    if (!full) return reply.code(404).send({ error: 'not_found' })
    return { user: publicUser(full) }
  })
}
