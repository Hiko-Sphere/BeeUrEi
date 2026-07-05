import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store, findByLoginIdentifier } from '../db/store'
import { hashPassword } from '../auth/passwords'
import { passwordPolicyError } from '../auth/passwordPolicy'
import { type CodeRegistry } from '../auth/codes'
import { type Mailer } from '../mail/mailer'
import { passwordResetMail } from '../mail/templates'
import { CodeSendLimiter } from '../auth/sendLimiter'
import { notifyAccountSecurity } from '../notifications/notify'
import { NoopPushSender, type PushSender } from '../push/apns'

const forgotSchema = z.object({ username: z.string().trim().min(1) })
const resetSchema = z.object({
  username: z.string().trim().min(1),
  code: z.string().min(4).max(12),
  newPassword: z.string().min(1).max(128), // 强度校验在 handler（passwordPolicy 单点）
})

/// 找回密码（D1）：忘记密码 → 向账号绑定邮箱发验证码 → 凭码重置。
/// 安全：① 不做用户枚举（无论用户/邮箱是否存在都返回 200）② 验证码哈希存储、限次、10 分钟过期
/// ③ 重置成功递增 tokenVersion 并撤销所有 refresh token（与改密一致，令旧令牌立即失效）。
export function registerRecoveryRoutes(app: FastifyInstance, store: Store, codes: CodeRegistry, mailer: Mailer, codeSend: CodeSendLimiter = new CodeSendLimiter(), pushSender: PushSender = new NoopPushSender()): void {
  // 发起找回：若该用户存在且绑定了邮箱，则发码。始终返回 ok，避免据响应判断账号/邮箱是否存在。
  app.post('/api/auth/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = forgotSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    // 发送侧节流：按**提交的标识**统一占额（无论账号是否存在），429 对所有人一致，保持反枚举。
    // 用原子 tryConsume（同步 check+record）与 auth/account 同口径；此处发信 fire-and-forget、无条件计入，故无需退还。
    const sendKey = `send:reset:${parsed.data.username.trim().toLowerCase()}`
    const dec = codeSend.tryConsume(sendKey, Date.now())
    if (!dec.ok) {
      reply.header('Retry-After', String(dec.retryAfterSec))
      return reply.code(429).send({ error: dec.reason === 'cooldown' ? 'code_cooldown' : 'code_too_many', retryAfterSec: dec.retryAfterSec })
    }
    // 标识解析与登录同口径（用户名/手机号/邮箱）——否则邮箱/手机号注册的用户（用户名自动生成、本人不知）无从找回。
    const user = findByLoginIdentifier(store, parsed.data.username)
    // 仅向**已验证**邮箱发码：未验证邮箱可能是拼错/他人地址，不应作为账号恢复锚点（见审查 #8）。
    if (user?.email && user.emailVerified) {
      const code = codes.issue(`reset:${user.id}`, Date.now())
      // fire-and-forget：不 await 发信，使"账号存在/不存在"两条路径响应时延一致，消除时序枚举侧信道（见审查 #9）。
      // catch 必须保留（避免 unhandledRejection），但记日志而非静默吞掉，便于排查发信故障（见复审 #7）。
      const m = passwordResetMail(code)
      void mailer
        .send(user.email, m.subject, m.text, m.html)
        .catch((e) => console.warn('[mail] 重置码发送失败:', (e as Error).message))
    }
    return { ok: true }
  })

  // 凭码重置：校验验证码 → 设新密码 + 递增 tokenVersion + 撤销 refresh token。
  app.post('/api/auth/reset-password', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = resetSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    // 上下文用**提交的登录标识**（不查库→不泄露账号是否存在；标识含 '@' 则本地部分也纳入词元）。
    const pwErr = passwordPolicyError(parsed.data.newPassword, { username: parsed.data.username, email: parsed.data.username })
    if (pwErr) return reply.code(400).send({ error: pwErr })
    const user = findByLoginIdentifier(store, parsed.data.username)
    if (!user || !codes.verify(`reset:${user.id}`, parsed.data.code, Date.now())) {
      return reply.code(400).send({ error: 'invalid_code' })
    }
    store.updateUser(user.id, {
      passwordHash: hashPassword(parsed.data.newPassword),
      tokenVersion: (user.tokenVersion ?? 0) + 1,
    })
    store.deleteRefreshTokensForUser(user.id)
    // 安全预警本人：密码刚通过"找回"被重置——若非本人操作（他人拿到验证码/接管邮箱），即时告知。
    notifyAccountSecurity(store, pushSender, user, 'password_reset')
    return { ok: true }
  })
}
