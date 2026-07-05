import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type Role, type User, selfView, matchBannedTerm, findByLoginIdentifier } from '../db/store'
import { hashPassword, verifyPassword } from '../auth/passwords'
import { hashToken, generateRefreshToken } from '../auth/tokens'
import { issueTokens, deviceLabelFromReq } from '../auth/session'
import { passwordPolicyError } from '../auth/passwordPolicy'
import { LoginThrottle } from '../auth/loginThrottle'
import { totpMatchedCounter, hashRecoveryCode } from '../auth/totp'
import { normalizePhone, type AppleTokenVerifier } from '../auth/apple'
import { type CodeRegistry } from '../auth/codes'
import { type Mailer } from '../mail/mailer'
import { loginCodeMail } from '../mail/templates'
import { CodeSendLimiter } from '../auth/sendLimiter'

const refreshSchema = z.object({ refreshToken: z.string().min(1) })

/// 两步验证登录门：用户已开 2FA 时，要求有效 TOTP 或一次性恢复码（消费掉）；未开则放行。
/// 注意：仅在**密码/邮箱码等第一因子已通过**之后调用，避免在验证身份前泄露账号是否开了 2FA。
function passTwoFactor(store: Store, user: User, code: string | undefined, now: number): { ok: boolean; reason?: 'required' | 'invalid' } {
  if (!user.totpEnabled || !user.totpSecret) return { ok: true }
  const c = (code ?? '').trim()
  if (!c) return { ok: false, reason: 'required' }
  const counter = totpMatchedCounter(user.totpSecret, c, now)
  if (counter != null) {
    // 单次使用防重放：拒绝 <= 上次已接受的时间步；接受则记录新计数，使该码（及其窗口内重复）不可再用。
    if (user.totpLastCounter != null && counter <= user.totpLastCounter) return { ok: false, reason: 'invalid' }
    store.updateUser(user.id, { totpLastCounter: counter })
    return { ok: true }
  }
  if (store.consumeRecoveryCode(user.id, hashRecoveryCode(c), now)) return { ok: true } // 恢复码兜底（本就一次性）
  return { ok: false, reason: 'invalid' }
}
function twoFactorReply(reply: any, reason: 'required' | 'invalid') {
  return reply.code(401).send({ error: reason === 'required' ? 'two_factor_required' : 'invalid_2fa' })
}

const registerSchema = z.object({
  // 用户名/手机号/邮箱至少给一个（refine 校验）；不给用户名时自动生成（不从手机号/邮箱派生——username 进 publicUser，派生会泄露隐私标识）。
  username: z.string().trim().min(3).max(32).optional(), // 去首尾空白，避免" alice"/"alice"混淆（见审查 #4）
  password: z.string().min(1).max(128), // 强度校验在 handler（passwordPolicy 单点，给具体错误码）
  displayName: z.string().trim().min(1).max(64).optional(), // trim 与改昵称端点(account.ts)一致——否则可注册出纯空白/带首尾空格的昵称（盲人来电播报会念到空名）
  // 自助注册仅限这些角色；admin/developer 由后台分配。
  role: z.enum(['blind', 'helper', 'family']).optional(),
  language: z.string().min(2).max(8).optional(), // 协助者/亲友语言，用于匹配排序（见审查 #10）
  email: z.string().email().max(254).optional(), // 邮箱：可作注册/登录标识，也用于找回密码（D1）
  phone: z.string().trim().min(6).max(20).optional(), // 手机号：可作注册/登录标识
}).refine((d) => d.username || d.phone || d.email, { message: 'identifier_required' })

const loginSchema = z.object({
  username: z.string().trim(), // 登录标识：用户名/手机号/邮箱（字段名保持 username 兼容旧客户端）
  password: z.string(),
  totpCode: z.string().max(64).optional(), // 开了 2FA 的账号：TOTP 6 位码或一次性恢复码（首次登录返回 two_factor_required 后补交）
})

// 常时防枚举：账号不存在时也对这个固定 dummy hash 跑一次 bcrypt（与真 hash 同 cost=10），
// 抹平"账号不存在→不跑 bcrypt 秒回 vs 存在→跑 bcrypt 慢 50-100ms"的计时旁路——否则未认证攻击者
// 可据登录响应耗时枚举已注册的用户名/邮箱/手机号（本 App 用户为视障者+亲友，隐私敏感）。模块加载时生成一次。
const DUMMY_PASSWORD_HASH = hashPassword('beeurei-login-timing-equalizer-not-a-real-credential')

const appleSchema = z.object({
  identityToken: z.string().min(1),
  displayName: z.string().trim().min(1).max(64).optional(), // Apple 仅首次授权给姓名，客户端透传；trim 同注册/改名口径
  role: z.enum(['blind', 'helper', 'family']).optional(),
  language: z.string().min(2).max(8).optional(),
})

const emailCodeRequestSchema = z.object({ email: z.string().email().max(254) })
const emailCodeVerifySchema = z.object({
  email: z.string().email().max(254),
  code: z.string().min(4).max(12),
  role: z.enum(['blind', 'helper', 'family']).optional(),
  language: z.string().min(2).max(8).optional(),
  totpCode: z.string().max(64).optional(), // 已开 2FA 的账号：邮箱码登录也须二次验证（否则邮箱即可绕过 2FA）
})

export function registerAuthRoutes(app: FastifyInstance, store: Store, codes: CodeRegistry, mailer: Mailer, appleVerifier?: AppleTokenVerifier, codeSend: CodeSendLimiter = new CodeSendLimiter(), loginThrottle: LoginThrottle = new LoginThrottle()): void {
  // 按账号登录节流（NIST 800-63B）见 loginThrottle.ts：默认 ≥10 连败后每 30s 一试、≥50 冷却
  // 15 分钟；参数经形参注入（测试用短延迟实例，与 mailer/codeSend 同一测试缝）。

  // 注册/登录/refresh 是凭证暴破与刷号的高危端点，给独立且更严格的限流（防口令暴破/凭证填充/批量刷号，见审查 #3）。
  app.post('/api/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input', details: parsed.error.flatten() })
    }
    // 全站注册开关（管理员可在后台关闭）：关闭后拒绝新建账号；已有账号登录不受影响。
    if (!store.getAppConfig().registrationEnabled) return reply.code(403).send({ error: 'registration_disabled' })
    // 口令策略（NIST 800-63B：长度+常见弱口令，无字符类别硬性要求）——具体错误码供客户端精确提示。
    // 仅密码注册路径需要；Apple/邮箱验证码注册无密码。
    const pwErr = passwordPolicyError(parsed.data.password, { username: parsed.data.username, email: parsed.data.email })
    if (pwErr) return reply.code(400).send({ error: pwErr })
    const { username: rawUsername, password, displayName, role, language, email, phone } = parsed.data
    // 昵称内容审核：与改昵称端点(account.ts)一致——否则注册时即可塞入违禁昵称绕过审核（everyone 可见）。
    if (displayName && matchBannedTerm(store.getAppConfig(), displayName)) return reply.code(403).send({ error: 'content_blocked' })
    // 用户名字符集：与改用户名端点(account.ts)一致——仅字母数字 _.- 。否则注册可塞入含空白/@//控制字符的
    // 用户名（虽各处显示已转义防 XSS，但会引起登录标识与邮箱(@)歧义、导出文件名注入、且改名时反而改不回同值）。
    if (rawUsername && !/^[A-Za-z0-9_.-]+$/.test(rawUsername)) return reply.code(400).send({ error: 'invalid_username' })
    // 用户名内容审核：与昵称同口径——用户名同样 everyone 可见(@username 现于资料/查找/后台)，
    // 否则把违禁词塞进用户名即可绕过昵称过滤（改用户名端点同补）。
    if (rawUsername && matchBannedTerm(store.getAppConfig(), rawUsername)) return reply.code(403).send({ error: 'content_blocked' })
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
    const tokens = issueTokens(store, user, { deviceLabel: deviceLabelFromReq(req.headers, (req.body as { deviceName?: string } | undefined)?.deviceName) })
    // created=true：客户端据此走"选择身份→设置 userid→绑定邮箱"的新账号引导（角色在引导里选，全方法统一）。
    return reply.code(201).send({ ...tokens, user: selfView(user), created: true })
  })

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_input' })
    }
    // 登录标识兼容用户名/手机号/邮箱（与找回密码共用 findByLoginIdentifier，避免口径漂移）。
    const user = findByLoginIdentifier(store, parsed.data.username)
    if (!user) {
      // 账号不存在也跑一次等价 bcrypt，令两路耗时一致、消除计时枚举旁路（见 DUMMY_PASSWORD_HASH 说明）。
      verifyPassword(parsed.data.password, DUMMY_PASSWORD_HASH)
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    // 按账号节流：密码校验**之前**判（正确与否一视同仁——否则撞库者猜中即进）。
    // retry-after 秒数下发，客户端可如实提示"稍后再试"。
    const th = loginThrottle.check(user.id, Date.now())
    if (!th.allowed) {
      reply.header('retry-after', String(Math.ceil((th.retryAfterMs ?? 0) / 1000)))
      return reply.code(429).send({ error: 'too_many_attempts' })
    }
    if (!verifyPassword(parsed.data.password, user.passwordHash)) {
      loginThrottle.recordFailure(user.id, Date.now())
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    if (user.status === 'disabled') {
      return reply.code(403).send({ error: 'account_disabled' })
    }
    // 两步验证：密码已校验通过后，再要求 TOTP/恢复码（已开启时）。失败同计入账号节流
    // （2FA 爆破也是对该账号的连续失败尝试）；two_factor_required（未带码的首步）不计——那是正常流程。
    const tf = passTwoFactor(store, user, parsed.data.totpCode, Date.now())
    if (!tf.ok) {
      if (tf.reason === 'invalid') loginThrottle.recordFailure(user.id, Date.now())
      return twoFactorReply(reply, tf.reason!)
    }
    loginThrottle.recordSuccess(user.id) // 完整成功才清零
    const tokens = issueTokens(store, user, { deviceLabel: deviceLabelFromReq(req.headers, (req.body as { deviceName?: string } | undefined)?.deviceName) })
    return reply.send({ ...tokens, user: selfView(user) })
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
        // 该邮箱账号已开两步验证：不做隐式 Apple 并号登录——否则 Apple 成了绕过用户 TOTP 的通道。
        // 让用户先用密码+TOTP 正常登录，再在「账号与安全」主动绑定 Apple（POST /api/account/apple，已 requireAuth）。
        if (byEmail.totpEnabled) return reply.code(409).send({ error: 'two_factor_link_required' })
        const linked = store.updateUser(byEmail.id, { appleSub: identity.sub, emailVerified: true }) ?? byEmail
        const tokens = issueTokens(store, linked, { deviceLabel: deviceLabelFromReq(req.headers, (req.body as { deviceName?: string } | undefined)?.deviceName) })
        return reply.send({ ...tokens, user: selfView(linked) }) // 登录已有账号，不是新建（无 created）
      }
    }
    if (!user) {
      // 注册关闭时拒绝新建 Apple 账号（已有 appleSub/可并号的邮箱在上面分支已登录，不受影响）。
      if (!store.getAppConfig().registrationEnabled) return reply.code(403).send({ error: 'registration_disabled' })
      // 昵称内容审核（与 register/profile 端点同口径，补 Apple 漏网）：Apple 首次授权的姓名由客户端透传，
      // 改造客户端可塞违禁词——昵称会显示给所有联系人（聊天/来电/通知/亲友列表），须同样过审，否则是绕过审核的口子。
      if (parsed.data.displayName && matchBannedTerm(store.getAppConfig(), parsed.data.displayName)) {
        return reply.code(403).send({ error: 'content_blocked' })
      }
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
      const tokens = issueTokens(store, user, { deviceLabel: deviceLabelFromReq(req.headers, (req.body as { deviceName?: string } | undefined)?.deviceName) })
      return reply.code(201).send({ ...tokens, user: selfView(user), created: true })
    }
    if (user.status === 'disabled') {
      return reply.code(403).send({ error: 'account_disabled' })
    }
    const tokens = issueTokens(store, user, { deviceLabel: deviceLabelFromReq(req.headers, (req.body as { deviceName?: string } | undefined)?.deviceName) })
    return reply.send({ ...tokens, user: selfView(user) })
  })

  // 重放宽限窗：轮换后的旧 refresh 在此窗内再次出现视为"响应丢失后的合法重试"（弱网/进程被杀），
  // 仍按原会话换发新对；超窗再现 = 被窃信号 → 吊销整个会话族（OWASP refresh rotation + reuse detection；
  // 宽限做法同 Auth0 reuse interval）。REFRESH_REUSE_GRACE_MS 可调，默认 30s；测试置 0 走严格路径。
  const reuseGraceMs = () => {
    const v = Number(process.env.REFRESH_REUSE_GRACE_MS)
    return Number.isFinite(v) && v >= 0 ? v : 30_000
  }
  // 用 refresh token 换新的一对 token（轮换：旧 refresh 留墓碑立即作废，重放触发会话族吊销）。
  app.post('/api/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = refreshSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const now = Date.now()
    const hash = hashToken(parsed.data.refreshToken)
    const rt = store.findRefreshToken(hash)
    if (!rt || rt.expiresAt < now) {
      if (rt) store.deleteRefreshToken(hash)
      return reply.code(401).send({ error: 'invalid_refresh_token' })
    }
    // 重放检测：墓碑再现。宽限窗内视为丢响应重试（放行换发）；超窗=此 token 曾被第二方用过 →
    // 无从分辨窃者与本人，吊销该会话全部 token（access 因 hasActiveSession 检查随之立即失效），
    // 强制该设备重新登录。错误码刻意与普通失效相同——不给攻击者"已被识破"的信号。
    if (rt.rotatedAt != null && now - rt.rotatedAt > reuseGraceMs()) {
      if (rt.sessionId) store.revokeSession(rt.userId, rt.sessionId)
      else store.deleteRefreshToken(hash)
      return reply.code(401).send({ error: 'invalid_refresh_token' })
    }
    const user = store.findById(rt.userId)
    if (!user || user.status === 'disabled') {
      store.deleteRefreshToken(hash)
      return reply.code(401).send({ error: 'invalid_refresh_token' })
    }
    if (rt.rotatedAt == null) store.markRefreshTokenRotated(hash, now) // 轮换：留墓碑（重放检测的基石）；宽限重试不刷新墓碑时刻
    // 续期：延续同一会话（sessionId 不变），更新 lastSeenAt，保留设备标签与创建时间——使「登录设备」列表稳定。
    const tokens = issueTokens(store, user, { sid: rt.sessionId, deviceLabel: rt.deviceLabel, createdAt: rt.createdAt })
    return reply.send({ ...tokens, user: selfView(user) })
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
    // 发送侧节流（防连点/轰炸）：按收件邮箱节流——已注册/未注册两条路径都发码，故节流对称，不泄露账号是否存在。
    const sendKey = `send:login:${email}`
    const sendAt = Date.now()
    // 原子占额：同步 check+record，消除「check→await 发信→record」的并发 TOCTOU（连发绕过冷却）。
    const dec = codeSend.tryConsume(sendKey, sendAt)
    if (!dec.ok) {
      reply.header('Retry-After', String(dec.retryAfterSec))
      return reply.code(429).send({ error: dec.reason === 'cooldown' ? 'code_cooldown' : 'code_too_many', retryAfterSec: dec.retryAfterSec })
    }
    const user = store.findByEmail(email)
    const key = user ? `login:${user.id}` : `signup:${email}`
    const code = codes.issue(key, Date.now())
    // 两条路径（邮箱已注册/未注册）都恰好发一封信再响应——时延对称，无枚举侧信道；
    // 发信失败明确返回 503（SMTP 故障是全局的，不泄露任何账号信息），不假装"已发送"。
    try {
      const m = loginCodeMail(code)
      await mailer.send(email, m.subject, m.text, m.html)
    } catch (e) {
      codeSend.refund(sendKey, sendAt) // 发信失败退还额度（不锁冷却，语义同旧「仅成功才计入」）
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
      // 已开 2FA：先 peek 邮箱码（不消费）→ 验第二因子（TOTP 非消费 / 恢复码先只检查不消费）→
      // 两因子都成立后先 verify 消费邮箱码，**成功后再**消费恢复码——避免登录失败却白烧一枚一次性恢复码。
      // 未开 2FA 则直接 verify 消费。两条路径都在放行前真正消费掉邮箱码（一次性）。
      if (existing.totpEnabled && existing.totpSecret) {
        if (!codes.peek(`login:${existing.id}`, parsed.data.code, Date.now())) {
          return reply.code(400).send({ error: 'invalid_code' })
        }
        const c = (parsed.data.totpCode ?? '').trim()
        if (!c) return twoFactorReply(reply, 'required')
        const counter = totpMatchedCounter(existing.totpSecret, c, Date.now())
        const totpOk = counter != null && (existing.totpLastCounter == null || counter > existing.totpLastCounter) // 含单次防重放
        const useRecovery = !totpOk && counter == null && store.hasUnusedRecoveryCode(existing.id, hashRecoveryCode(c))
        if (!totpOk && !useRecovery) return twoFactorReply(reply, 'invalid')
        if (!codes.verify(`login:${existing.id}`, parsed.data.code, Date.now())) {
          return reply.code(400).send({ error: 'invalid_code' })
        }
        if (totpOk) store.updateUser(existing.id, { totpLastCounter: counter! })
        if (useRecovery) store.consumeRecoveryCode(existing.id, hashRecoveryCode(c), Date.now())
      } else if (!codes.verify(`login:${existing.id}`, parsed.data.code, Date.now())) {
        return reply.code(400).send({ error: 'invalid_code' })
      }
      // 成功登录即证明邮箱归属 → 标记已验证。
      const updated = (existing.emailVerified ? existing : store.updateUser(existing.id, { emailVerified: true })) ?? existing
      const tokens = issueTokens(store, updated, { deviceLabel: deviceLabelFromReq(req.headers, (req.body as { deviceName?: string } | undefined)?.deviceName) })
      return reply.send({ ...tokens, user: selfView(updated) })
    }
    // 新邮箱注册：校验 signup 码 → 建号。注册关闭时拒绝新建（已有邮箱登录走上面分支不受影响）。
    if (!store.getAppConfig().registrationEnabled) return reply.code(403).send({ error: 'registration_disabled' })
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
    const tokens = issueTokens(store, user, { deviceLabel: deviceLabelFromReq(req.headers, (req.body as { deviceName?: string } | undefined)?.deviceName) })
    return reply.code(201).send({ ...tokens, user: selfView(user), created: true })
  })
}
