import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { hashPassword, verifyPassword } from '../auth/passwords'
import { type CodeRegistry } from '../auth/codes'
import { type Mailer } from '../mail/mailer'
import { normalizePhone } from '../auth/apple'

const passwordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6).max(128),
})
const emailSchema = z.object({ email: z.string().email().max(254) })
const verifyEmailSchema = z.object({ code: z.string().min(4).max(12) })
// 昵称（displayName）：可改、可重复；用户名(username)才是唯一登录标识。通话/CallKit 显示昵称。
const profileSchema = z.object({ displayName: z.string().trim().min(1).max(64) })
// 播报语言偏好（"zh"/"en"…）：推送文案（pushStrings）与匹配排序按此选语言；App 登录/改语言时上报。
const languageSchema = z.object({ language: z.string().trim().min(2).max(8) })
// 头像：小尺寸图片 data URL（客户端已压缩）。限大小，防滥用 DB 存大图。
const avatarSchema = z.object({
  avatar: z.string().regex(/^data:image\/(png|jpeg|jpg|webp);base64,/).max(600_000),
})

export function registerAccountRoutes(app: FastifyInstance, store: Store, codes: CodeRegistry, mailer: Mailer): void {
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

  // 更新语言偏好：推送文案与求助匹配排序按此选语言。
  app.post('/api/account/language', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = languageSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const updated = store.updateUser(req.user!.sub, { language: parsed.data.language })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    return { ok: true }
  })

  // 绑定/换绑手机号（手机号+密码登录的标识）：归一化 + 全局唯一（不能占用他人手机号）。
  app.post('/api/account/phone', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = z.object({ phone: z.string().trim().min(6).max(20) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const p = normalizePhone(parsed.data.phone)
    if (!p) return reply.code(400).send({ error: 'invalid_phone' })
    const existing = store.findByPhone(p)
    if (existing && existing.id !== req.user!.sub) return reply.code(409).send({ error: 'phone_taken' })
    const updated = store.updateUser(req.user!.sub, { phone: p })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    return { ok: true }
  })

  // 设置/更新邮箱（D1）：保存邮箱并标记未验证，随即发一封验证码邮件。
  app.post('/api/account/email', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = emailSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    // 规范化 + 唯一性：邮箱是账号身份锚，不能被设成他人已用的邮箱（见审查 #13）。
    const email = parsed.data.email.trim().toLowerCase()
    if (store.allUsers().some((u) => u.id !== user.id && (u.email ?? '').toLowerCase() === email)) {
      return reply.code(409).send({ error: 'email_taken' })
    }
    store.updateUser(user.id, { email, emailVerified: false })
    const code = codes.issue(`verify:${user.id}`, Date.now())
    await mailer.send(email, 'BeeUrEi 邮箱验证码', `你的邮箱验证码是：${code}（10 分钟内有效）。`)
    return { ok: true }
  })

  // 校验邮箱验证码（D1）：成功则标记 emailVerified=true。
  app.post('/api/account/email/verify', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = verifyEmailSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    if (!codes.verify(`verify:${user.id}`, parsed.data.code, Date.now())) {
      return reply.code(400).send({ error: 'invalid_code' })
    }
    store.updateUser(user.id, { emailVerified: true })
    return { ok: true }
  })

  // 设置昵称（displayName）。用户名唯一不可改；昵称可改、可重复，用于通话/CallKit/列表显示。
  app.post('/api/account/profile', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = profileSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    if (!store.findById(req.user!.sub)) return reply.code(404).send({ error: 'not_found' })
    const updated = store.updateUser(req.user!.sub, { displayName: parsed.data.displayName })
    return { displayName: updated?.displayName }
  })

  // 设置头像（小尺寸 data URL；客户端压缩后上传）。
  app.post('/api/account/avatar', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = avatarSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    if (!store.findById(req.user!.sub)) return reply.code(404).send({ error: 'not_found' })
    store.updateUser(req.user!.sub, { avatar: parsed.data.avatar })
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
