import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { hashPassword, verifyPassword } from '../auth/passwords'

const passwordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6).max(128),
})

export function registerAccountRoutes(app: FastifyInstance, store: Store): void {
  // 修改密码：验证旧密码 → 设新密码 → 递增 tokenVersion(令已签发的 access token 立即失效) → 撤销所有 refresh token。
  // 递增 tokenVersion 是关键：否则被盗号者手里的 access token 在改密后仍可用最长 1h，改密自救形同虚设（见审查 #2）。
  app.post('/api/account/password', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = passwordSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    if (!verifyPassword(parsed.data.oldPassword, user.passwordHash)) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    store.updateUser(user.id, {
      passwordHash: hashPassword(parsed.data.newPassword),
      tokenVersion: (user.tokenVersion ?? 0) + 1,
    })
    store.deleteRefreshTokensForUser(user.id)
    return { ok: true }
  })

  // 删除账号（App Store 要求）：删除用户 + 其亲友绑定(双向) + refresh token。
  app.delete('/api/account', { preHandler: requireAuth() }, async (req, reply) => {
    const id = req.user!.sub
    for (const l of store.linksByOwner(id)) store.deleteLink(l.id)
    for (const l of store.linksByMember(id)) store.deleteLink(l.id)
    store.deleteRefreshTokensForUser(id)
    store.deleteUser(id)
    return reply.code(204).send()
  })
}
