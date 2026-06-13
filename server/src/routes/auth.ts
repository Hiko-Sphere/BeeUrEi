import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type Role, type User, publicUser } from '../db/store'
import { hashPassword, verifyPassword } from '../auth/passwords'
import { signAccessToken, generateRefreshToken, hashToken, refreshTtlMs } from '../auth/tokens'
import { normalizePhone, type AppleTokenVerifier } from '../auth/apple'
import { type CodeRegistry } from '../auth/codes'
import { type Mailer } from '../mail/mailer'

/// 签发 access + refresh 一对（refresh 仅存哈希）。
function issueTokens(store: Store, user: User): { token: string; refreshToken: string } {
  const token = signAccessToken({ sub: user.id, role: user.role, tv: user.tokenVersion ?? 0 })
  const refreshToken = generateRefreshToken()
  store.createRefreshToken({ tokenHash: hashToken(refreshToken), userId: user.id, expiresAt: Date.now() + refreshTtlMs })
  return { token, refreshToken }
}

const refreshSchema = z.object({ refreshToken: z.string().min(1) })

const registerSchema = z.object({
  // 用户名/手机号/邮箱至少给一个（refine 校验）；不给用户名时自动生成（不从手机号/邮箱派生——username 进 publicUser，派生会泄露隐私标识）。
  username: z.string().trim().min(3).max(32).optional(), // 去首尾空白，避免" alice"/"alice"混淆（见审查 #4）
  password: z.string().min(6).max(128),
  displayName: z.string().min(1).max(64).optional(),
  // 自助注册仅限这些角色；admin/developer 由后台分配。
  role: z.enum(['blind', 'helper', 'family']).optional(),
  language: z.string().min(2).max(8).optional(), // 协助者/亲友语言，用于匹配排序（见审查 #10）
  email: z.string().email().max(254).optional(), // 邮箱：可作注册/登录标识，也用于找回密码（D1）
  phone: z.string().trim().min(6).max(20).optional(), // 手机号：可作注册/登录标识
}).refine((d) => d.username || d.phone || d.email, { message: 'identifier_required' })

const loginSchema = z.object({
  username: z.string().trim(), // 登录标识：用户名/手机号/邮箱（字段名保持 username 兼容旧客户端）
  password: z.string(),
})

const appleSchema = z.object({
  identityToken: z.string().min(1),
  displayName: z.string().min(1).max(64).optional(), // Apple 仅首次授权给姓名，客户端透传
  role: z.enum(['blind', 'helper', 'family']).optional(),
  language: z.string().min(2).max(8).optional(),
})

const emailCodeRequestSchema = z.object({ email: z.string().email().max(254) })
const emailCodeVerifySchema = z.object({
  email: z.string().email().max(254),
  code: z.string().min(4).max(12),
  role: z.enum(['blind', 'helper', 'family']).optional(),
  language: z.string().min(2).max(8).optional(),
})

export function registerAuthRoutes(app: FastifyInstance, store: Store, codes: CodeRegistry, mailer: Mailer, appleVerifier?: AppleTokenVerifier): void {
  // 注册/登录/refresh 是凭证暴破与刷号的高危端点，给独立且更严格的限流（防口令暴破/凭证填充/批量刷号，见审查 #3）。
  app.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
    }
    const { username: rawUsername, password, displayName, role, language, email, phone } = parsed.data
    if (rawUsername && store.findByUsername(rawUsername)) {
      return reply.code(409).send({ error: 'username_taken' })
    }
    // 规范化邮箱 + 唯一性（邮箱是账号身份锚 + 登录标识，见审查 #13）。
    const normEmail = email?.trim().toLowerCase()
    if (normEmail && store.findByEmail(normEmail)) {
      return reply.code(409).send({ error: 'email_taken' })
    }
    // 手机号归一化 + 唯一性（手机号也是登录标识，与用户名同等对待）。
    let normPhone: string | undefined
    if (phone) {
      const p = normalizePhone(phone)
      if (!p) return reply.code(400).send({ error: 'invalid_phone' })
      if (store.findByPhone(p)) return reply.code(409).send({ error: 'phone_taken' })
      normPhone = p
    }
    // 免用户名注册（手机号/邮箱即账号）：自动生成随机用户名（可在账号页改昵称；
    // 不从手机号/邮箱派生——username 进 publicUser 对外可见，派生会泄露隐私标识）。
    let username = rawUsername
    if (!username) {
      username = `user_${randomUUID().slice(0, 8)}`
      while (store.findByUsername(username)) username = `user_${randomUUID().slice(0, 8)}`
    }
    const user: User = {
      id: randomUUID(),
      username,
      passwordHash: hashPassword(password),
      displayName: displayName ?? username,
      role: (role ?? 'blind') as Role,
      status: 'active',
      createdAt: Date.now(),
      language,
      email: normEmail,
      emailVerified: normEmail ? false : undefined,
      phone: normPhone,
      usernameCustomized: !!rawUsername, // 显式给了用户名=已自定义；自动生成的为 false，客户端会提示设置唯一 userid
    }
    store.createUser(user)
    const tokens = issueTokens(store, user)
    // created=true：客户端据此走"选择身份→设置 userid→绑定邮箱"的新账号引导（角色在引导里选，全方法统一）。
    return reply.code(201).send({ ...tokens, user: publicUser(user), created: true })
  })

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' })
    }
    // 登录标识兼容用户名/手机号/邮箱：先按用户名查，再按归一化手机号，最后按邮箱（含 @ 才试）。
    const identifier = parsed.data.username
    const byPhone = (): User | undefined => {
      const p = normalizePhone(identifier)
      return p ? store.findByPhone(p) : undefined
    }
    const byEmail = (): User | undefined =>
      identifier.includes('@') ? store.findByEmail(identifier) : undefined
    const user = store.findByUsername(identifier) ?? byPhone() ?? byEmail()
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    if (user.status === 'disabled') {
      return reply.code(403).send({ error: 'account_disabled' })
    }
    const tokens = issueTokens(store, user)
    return reply.send({ ...tokens, user: publicUser(user) })
  })

  // Sign in with Apple：客户端送 identityToken，服务端验签（Apple JWKS + iss/aud/exp）后按 sub 登录/建号。
  // 未配置 APPLE_BUNDLE_ID 时明确返回 503（而非假装成功），与登录同级限流防刷。
  app.post('/api/auth/apple', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!appleVerifier) return reply.code(503).send({ error: 'apple_login_not_configured' })
    const parsed = appleSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const identity = await appleVerifier(parsed.data.identityToken)
    if (!identity) return reply.code(401).send({ error: 'invalid_apple_token' })

    let user = store.findByAppleSub(identity.sub)
    // 关键修复：appleSub 未匹配时，先按 **Apple 已验证的邮箱** 找现有账号——
    // 若该邮箱已属某账号（且尚未绑 Apple），则把本 Apple 并入该账号并登录，而不是另建新号。
    // 这正是 Sign in with Apple 的标准并号行为：Apple 已验证邮箱归属，安全。（见用户反馈 bug #1）
    if (!user && identity.email && identity.emailVerified) {
      const byEmail = store.findByEmail(identity.email.toLowerCase())
      if (byEmail && !byEmail.appleSub) {
        if (byEmail.status === 'disabled') return reply.code(403).send({ error: 'account_disabled' })
        const linked = store.updateUser(byEmail.id, { appleSub: identity.sub, emailVerified: true }) ?? byEmail
        const tokens = issueTokens(store, linked)
        return reply.send({ ...tokens, user: publicUser(linked) }) // 登录已有账号，不是新建（无 created）
      }
    }
    if (!user) {
      // 新 Apple 用户自动建号：生成不冲突的用户名（可日后在账号页修改）。
      let username = `apple_${identity.sub.slice(-8)}`
      while (store.findByUsername(username)) username = `apple_${randomUUID().slice(0, 8)}`
      // 仅当该邮箱未被占用时才写入新号（email 列非唯一，避免造成重复邮箱账号；上面已优先并号）。
      const appleEmail = identity.email?.toLowerCase()
      const emailFree = appleEmail ? !store.findByEmail(appleEmail) : false
      user = {
        id: randomUUID(),
        username,
        // 随机密码占位（Apple 用户走 Apple 登录；如需密码登录可用找回流程设置）。
        passwordHash: hashPassword(generateRefreshToken()),
        displayName: parsed.data.displayName ?? 'Apple 用户',
        role: (parsed.data.role ?? 'blind') as Role,
        status: 'active',
        createdAt: Date.now(),
        language: parsed.data.language,
        email: emailFree ? appleEmail : undefined,
        emailVerified: emailFree ? true : undefined, // Apple 已验证过邮箱
        appleSub: identity.sub,
        usernameCustomized: false, // 自动生成 apple_ 用户名，客户端会提示设置唯一 userid
      }
      store.createUser(user)
      const tokens = issueTokens(store, user)
      return reply.code(201).send({ ...tokens, user: publicUser(user), created: true })
    }
    if (user.status === 'disabled') {
      return reply.code(403).send({ error: 'account_disabled' })
    }
    const tokens = issueTokens(store, user)
    return reply.send({ ...tokens, user: publicUser(user) })
  })

  // 用 refresh token 换新的一对 token（轮换：旧 refresh 立即作废）。
  app.post('/api/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const hash = hashToken(parsed.data.refreshToken)
    const rt = store.findRefreshToken(hash)
    if (!rt || rt.expiresAt < Date.now()) {
      if (rt) store.deleteRefreshToken(hash)
      return reply.code(401).send({ error: 'invalid_refresh_token' })
    }
    const user = store.findById(rt.userId)
    if (!user || user.status === 'disabled') {
      store.deleteRefreshToken(hash)
      return reply.code(401).send({ error: 'invalid_refresh_token' })
    }
    store.deleteRefreshToken(hash) // 轮换
    const tokens = issueTokens(store, user)
    return reply.send({ ...tokens, user: publicUser(user) })
  })

  // 登出：撤销该 refresh token。
  app.post('/api/auth/logout', async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    store.deleteRefreshToken(hashToken(parsed.data.refreshToken))
    return reply.code(204).send()
  })

  // 邮箱验证码登录/注册（无密码，“魔法码”式）：发码。无论邮箱是否已注册都返回 ok（防枚举）。
  // token 未过期时客户端走恢复/刷新不走此码（“token 没过期就不用验证码”）。
  app.post('/api/auth/email/request-code', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = emailCodeRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const email = parsed.data.email.trim().toLowerCase()
    const user = store.findByEmail(email)
    const key = user ? `login:${user.id}` : `signup:${email}`
    const code = codes.issue(key, Date.now())
    // 两条路径（邮箱已注册/未注册）都恰好发一封信再响应——时延对称，无枚举侧信道；
    // 发信失败明确返回 503（SMTP 故障是全局的，不泄露任何账号信息），不假装"已发送"。
    try {
      await mailer.send(email, 'BeeUrEi 登录验证码', `你的登录验证码是：${code}（10 分钟内有效）。若非你本人操作请忽略。`)
    } catch (e) {
      console.warn('[mail] 登录码发送失败:', (e as Error).message)
      return reply.code(503).send({ error: 'mail_unavailable' })
    }
    return { ok: true }
  })

  // 邮箱验证码校验：已有账号即登录（并标记邮箱已验证）；无账号则建号（自动用户名，待客户端自定义 userid）。
  app.post('/api/auth/email/verify-code', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = emailCodeVerifySchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const email = parsed.data.email.trim().toLowerCase()
    const existing = store.findByEmail(email)
    if (existing) {
      if (existing.status === 'disabled') return reply.code(403).send({ error: 'account_disabled' })
      if (!codes.verify(`login:${existing.id}`, parsed.data.code, Date.now())) {
        return reply.code(400).send({ error: 'invalid_code' })
      }
      // 成功登录即证明邮箱归属 → 标记已验证。
      const updated = (existing.emailVerified ? existing : store.updateUser(existing.id, { emailVerified: true })) ?? existing
      const tokens = issueTokens(store, updated)
      return reply.send({ ...tokens, user: publicUser(updated) })
    }
    // 新邮箱注册：校验 signup 码 → 建号。
    if (!codes.verify(`signup:${email}`, parsed.data.code, Date.now())) {
      return reply.code(400).send({ error: 'invalid_code' })
    }
    let username = `user_${randomUUID().slice(0, 8)}`
    while (store.findByUsername(username)) username = `user_${randomUUID().slice(0, 8)}`
    const user: User = {
      id: randomUUID(),
      username,
      passwordHash: hashPassword(generateRefreshToken()), // 占位随机密码（无密码登录；可后续设密码）
      displayName: username,
      role: (parsed.data.role ?? 'blind') as Role,
      status: 'active',
      createdAt: Date.now(),
      language: parsed.data.language,
      email,
      emailVerified: true,
      usernameCustomized: false,
    }
    store.createUser(user)
    const tokens = issueTokens(store, user)
    return reply.code(201).send({ ...tokens, user: publicUser(user), created: true })
  })
}
