import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { hashPassword } from '../auth/passwords'
import { type CodeRegistry } from '../auth/codes'
import { type Mailer } from '../mail/mailer'

const forgotSchema = z.object({ username: z.string().trim().min(1) })
const resetSchema = z.object({
  username: z.string().trim().min(1),
  code: z.string().min(4).max(12),
  newPassword: z.string().min(6).max(128),
})

/// 找回密码（D1）：忘记密码 → 向账号绑定邮箱发验证码 → 凭码重置。
/// 安全：① 不做用户枚举（无论用户/邮箱是否存在都返回 200）② 验证码哈希存储、限次、10 分钟过期
/// ③ 重置成功递增 tokenVersion 并撤销所有 refresh token（与改密一致，令旧令牌立即失效）。
export function registerRecoveryRoutes(app: FastifyInstance, store: Store, codes: CodeRegistry, mailer: Mailer): void {
  // 发起找回：若该用户存在且绑定了邮箱，则发码。始终返回 ok，避免据响应判断账号/邮箱是否存在。
  app.post('/api/auth/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = forgotSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const user = store.findByUsername(parsed.data.username)
    if (user?.email) {
      const code = codes.issue(`reset:${user.id}`, Date.now())
      await mailer.send(user.email, 'BeeUrEi 重置密码验证码', `你的重置密码验证码是：${code}（10 分钟内有效）。若非你本人操作请忽略。`)
    }
    return { ok: true }
  })

  // 凭码重置：校验验证码 → 设新密码 + 递增 tokenVersion + 撤销 refresh token。
  app.post('/api/auth/reset-password', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = resetSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const user = store.findByUsername(parsed.data.username)
    if (!user || !codes.verify(`reset:${user.id}`, parsed.data.code, Date.now())) {
      return reply.code(400).send({ error: 'invalid_code' })
    }
    store.updateUser(user.id, {
      passwordHash: hashPassword(parsed.data.newPassword),
      tokenVersion: (user.tokenVersion ?? 0) + 1,
    })
    store.deleteRefreshTokensForUser(user.id)
    return { ok: true }
  })
}
