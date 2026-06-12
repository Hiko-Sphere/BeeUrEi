import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store, type User } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { hashPassword, verifyPassword } from '../auth/passwords'
import { type CodeRegistry } from '../auth/codes'
import { type Mailer } from '../mail/mailer'
import { normalizePhone, type AppleTokenVerifier } from '../auth/apple'

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

export function registerAccountRoutes(app: FastifyInstance, store: Store, codes: CodeRegistry, mailer: Mailer, appleVerifier?: AppleTokenVerifier): void {
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

  // 修改/设置用户名（唯一登录标识）：校验格式 + 唯一性（大小写不敏感）；成功后标记 usernameCustomized=true。
  // access token 以 user id 为 sub，改用户名不影响现有令牌。用于 Apple/邮箱登录后自定义唯一 userid。
  app.post('/api/account/username', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = z.object({ username: z.string().trim().min(3).max(32) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const username = parsed.data.username
    if (!/^[A-Za-z0-9_.-]+$/.test(username)) return reply.code(400).send({ error: 'invalid_username' }) // 仅字母数字 _.- ，禁空白/混淆字符
    const existing = store.findByUsername(username)
    if (existing && existing.id !== req.user!.sub) return reply.code(409).send({ error: 'username_taken' })
    const updated = store.updateUser(req.user!.sub, { username, usernameCustomized: true })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    return { username: updated.username }
  })

  // 绑定/换绑 Apple ID 到当前账号：验签 identityToken → 确保该 appleSub 未被他人占用 → 写入。
  // “Apple ID 登录则邮箱就是 Apple ID 的邮箱”：本账号无邮箱时顺带绑定 Apple 已验证邮箱。
  app.post('/api/account/apple', { preHandler: requireAuth() }, async (req, reply) => {
    if (!appleVerifier) return reply.code(503).send({ error: 'apple_login_not_configured' })
    const parsed = z.object({ identityToken: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const identity = await appleVerifier(parsed.data.identityToken)
    if (!identity) return reply.code(401).send({ error: 'invalid_apple_token' })
    const owner = store.findByAppleSub(identity.sub)
    if (owner && owner.id !== req.user!.sub) return reply.code(409).send({ error: 'apple_taken' })
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    const patch: Partial<User> = { appleSub: identity.sub }
    if (identity.email) {
      const appleEmail = identity.email.toLowerCase()
      const emailOwner = store.findByEmail(appleEmail)
      if ((!emailOwner || emailOwner.id === user.id) && !user.email) {
        patch.email = appleEmail
        patch.emailVerified = true
      }
    }
    store.updateUser(user.id, patch)
    return { ok: true, appleLinked: true }
  })

  // 解绑 Apple ID：仅在仍保留其它登录方式（手机号/已验证邮箱/passkey）时允许，避免锁死账号。
  app.delete('/api/account/apple', { preHandler: requireAuth() }, async (req, reply) => {
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    if (!user.appleSub) return { ok: true, appleLinked: false }
    const hasPasskey = store.passkeysForUser(user.id).length > 0
    const hasOtherLogin = !!user.phone || (!!user.email && user.emailVerified === true) || hasPasskey
    if (!hasOtherLogin) return reply.code(400).send({ error: 'last_login_method' })
    store.updateUser(user.id, { appleSub: undefined })
    return { ok: true, appleLinked: false }
  })

  // 设置/更新邮箱（D1）：保存邮箱并标记未验证，随即发一封验证码邮件。
  app.post('/api/account/email', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = emailSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    // 规范化 + 唯一性：邮箱是账号身份锚，不能被设成他人已用的邮箱（见审查 #13）。
    const email = parsed.data.email.trim().toLowerCase()
    const existing = store.findByEmail(email)
    if (existing && existing.id !== user.id) {
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
    for (const pk of store.passkeysForUser(id)) store.deletePasskey(pk.id, id)
    store.deleteRefreshTokensForUser(id)
    store.deleteUser(id)
    return reply.code(204).send()
  })
}
