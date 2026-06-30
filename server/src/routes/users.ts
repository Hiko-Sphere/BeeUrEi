import type { FastifyInstance } from 'fastify'
import { type Store, selfView, publicUser, findByLoginIdentifier } from '../db/store'
import { requireAuth } from '../auth/rbac'

export function registerUserRoutes(app: FastifyInstance, store: Store): void {
  app.get('/api/me', { preHandler: requireAuth() }, async (req, reply) => {
    const auth = req.user!
    const full = store.findById(auth.sub)
    if (!full) return reply.code(404).send({ error: 'not_found' })
    // 含本人邮箱/语言/验证状态（D1）+ 是否已注册 passkey（账号页展示/管理）。
    return { user: { ...selfView(full), hasPasskey: store.passkeysForUser(full.id).length > 0 } }
  })

  // 按 **精确** 标识查人（用户名 / 邮箱 / 手机号），用于"按邮箱或手机号添加亲友/协助者"。
  // 只做精确匹配（非模糊搜索）→ 无法枚举用户；限流防扫号；只返回公开资料（不回邮箱/手机号）。
  app.get('/api/users/lookup', {
    preHandler: requireAuth(),
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const q = String((req.query as { q?: string })?.q ?? '').trim()
    if (q.length < 3) return reply.code(400).send({ error: 'invalid_input' })
    // 标识解析与登录/找回同口径（findByLoginIdentifier）——三处统一，避免漂移。
    const found = findByLoginIdentifier(store, q)
    if (!found || found.id === req.user!.sub || found.status === 'disabled') {
      return reply.code(404).send({ error: 'not_found' })
    }
    return { user: publicUser(found) }
  })
}
