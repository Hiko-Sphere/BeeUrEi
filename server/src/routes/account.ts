import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store, type User, matchBannedTerm } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { buildUserExportBundle, buildSelfExportExtras } from '../account/exportBundle'
import { passwordPolicyError } from '../auth/passwordPolicy'
import { hashPassword, verifyPassword } from '../auth/passwords'
import { generateTotpSecret, totpMatchedCounter, otpauthURI, generateRecoveryCodes, hashRecoveryCode } from '../auth/totp'
import { type CodeRegistry } from '../auth/codes'
import { type Mailer } from '../mail/mailer'
import { emailVerificationMail } from '../mail/templates'
import { CodeSendLimiter } from '../auth/sendLimiter'
import { normalizePhone, type AppleTokenVerifier } from '../auth/apple'
import { cascadeDeleteUser } from '../db/cascade'
import { notifyAccountSecurity } from '../notifications/notify'
import type { SecurityEvent } from '../push/pushStrings'
import { NoopPushSender, type PushSender } from '../push/apns'

const passwordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(1).max(128), // 强度校验在 handler（passwordPolicy 单点）
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

export function registerAccountRoutes(app: FastifyInstance, store: Store, codes: CodeRegistry, mailer: Mailer, appleVerifier?: AppleTokenVerifier, codeSend: CodeSendLimiter = new CodeSendLimiter(), pushSender: PushSender = new NoopPushSender()): void {
  // 账号安全敏感变更 → 通知本人（in-app 持久化 + best-effort 推送到本人设备）：未授权变更即时预警。
  // 委托共享的 notifyAccountSecurity（单一真相，与 recovery/passkey 各路同口径，防漂移）。
  const notifySecurity = (u: User, event: SecurityEvent) => notifyAccountSecurity(store, pushSender, u, event)
  // 修改密码：验证旧密码 → 设新密码 → 递增 tokenVersion(令已签发的 access token 立即失效) → 撤销所有 refresh token。
  // 递增 tokenVersion 是关键：否则被盗号者手里的 access token 在改密后仍可用最长 1h，改密自救形同虚设（见审查 #2）。
  // 限流：校验 oldPassword 而无内置尝试上限（不同于走 CodeRegistry 5 次上限的验证码端点）。
  // 防：持有被盗 access token 者暴力猜 oldPassword → 改密 → 吊销原会话 → 把临时访问升级为持久接管。
  // 与 2FA/login 等校验秘密的端点同口径(10/min)。
  app.post('/api/account/password', { preHandler: requireAuth(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = passwordSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    // 口令策略含上下文相似（不得用自己的用户名/邮箱当密码）——须先取到 user 才有身份字段。
    const pwErr = passwordPolicyError(parsed.data.newPassword, { username: user.username, email: user.email })
    if (pwErr) return reply.code(400).send({ error: pwErr })
    if (!verifyPassword(parsed.data.oldPassword, user.passwordHash)) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    store.updateUser(user.id, {
      passwordHash: hashPassword(parsed.data.newPassword),
      tokenVersion: (user.tokenVersion ?? 0) + 1,
    })
    store.deleteRefreshTokensForUser(user.id)
    notifySecurity(user, 'password_changed')
    return { ok: true }
  })

  // MARK: 两步验证（2FA / TOTP）

  // 校验第二因子：有效 TOTP 或一次性恢复码（恢复码会被消费）。用于关闭/重生成恢复码这类敏感操作的再确认。
  const verifySecondFactor = (user: User, code: string | undefined, now: number): boolean => {
    if (!user.totpSecret) return false
    const c = (code ?? '').trim()
    if (!c) return false
    const counter = totpMatchedCounter(user.totpSecret, c, now)
    if (counter != null) {
      if (user.totpLastCounter != null && counter <= user.totpLastCounter) return false // 单次防重放
      store.updateUser(user.id, { totpLastCounter: counter })
      return true
    }
    return store.consumeRecoveryCode(user.id, hashRecoveryCode(c), now) // 恢复码兜底
  }
  const twoFASchema = z.object({ code: z.string().min(1).max(64) })

  // 当前 2FA 状态（开关 + 剩余恢复码数）。
  app.get('/api/account/2fa', { preHandler: requireAuth() }, async (req, reply) => {
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    return { enabled: !!user.totpEnabled, recoveryCodesRemaining: user.totpEnabled ? store.countUnusedRecoveryCodes(user.id) : 0 }
  })

  // 开始绑定：生成新密钥（待启用，enabled 仍为 false），返回 base32 密钥 + otpauth URI。
  // 盲人可直接复制密钥手动添加到验证器，或点 otpauth 链接自动添加。
  app.post('/api/account/2fa/setup', { preHandler: requireAuth(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    if (user.totpEnabled) return reply.code(409).send({ error: 'already_enabled' })
    const secret = generateTotpSecret()
    store.updateUser(user.id, { totpSecret: secret, totpEnabled: false })
    return { secret, otpauthUri: otpauthURI(secret, user.email ?? user.username) }
  })

  // 确认启用：校验验证器算出的码 → 启用 + 生成一批一次性恢复码（明文只此一次返回）。
  app.post('/api/account/2fa/enable', { preHandler: requireAuth(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = twoFASchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    if (user.totpEnabled) return reply.code(409).send({ error: 'already_enabled' })
    if (!user.totpSecret) return reply.code(400).send({ error: 'not_setup' })
    const counter = totpMatchedCounter(user.totpSecret, parsed.data.code, Date.now())
    if (counter == null) return reply.code(400).send({ error: 'invalid_code' })
    const codes = generateRecoveryCodes()
    store.replaceRecoveryCodes(user.id, codes.map(hashRecoveryCode))
    // 同时记录启用所用的时间步：避免同一码在 90s 内被重放到首次登录（单次使用从启用即生效）。
    store.updateUser(user.id, { totpEnabled: true, totpLastCounter: counter })
    notifySecurity(user, '2fa_enabled')
    return { ok: true, recoveryCodes: codes }
  })

  // 关闭 2FA：须再次验证本人（TOTP 或恢复码）→ 清密钥 + 关 + 清恢复码。
  app.post('/api/account/2fa/disable', { preHandler: requireAuth(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = twoFASchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    if (!user.totpEnabled) return reply.code(409).send({ error: 'not_enabled' })
    if (!verifySecondFactor(user, parsed.data.code, Date.now())) return reply.code(400).send({ error: 'invalid_code' })
    store.updateUser(user.id, { totpEnabled: false, totpSecret: undefined })
    store.deleteRecoveryCodesForUser(user.id)
    notifySecurity(user, '2fa_disabled')
    return { ok: true }
  })

  // 重新生成恢复码（旧码全部作废）：须再次验证本人。
  app.post('/api/account/2fa/recovery-codes', { preHandler: requireAuth(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = twoFASchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    if (!user.totpEnabled) return reply.code(409).send({ error: 'not_enabled' })
    if (!verifySecondFactor(user, parsed.data.code, Date.now())) return reply.code(400).send({ error: 'invalid_code' })
    const codes = generateRecoveryCodes()
    store.replaceRecoveryCodes(user.id, codes.map(hashRecoveryCode))
    // 重生成恢复码=替换一种登录凭据（旧码全作废、发新码）：与改密/2FA 开关/绑解 Apple 等一致预警本人——
    // 接管者拿到会话+过一次二次验证后可借此换一套自己的恢复码锁定账号，本人须即时知情（补漏的姊妹缺口）。
    notifySecurity(user, '2fa_recovery_regenerated')
    return { ok: true, recoveryCodes: codes }
  })

  // MARK: 登录设备 / 会话管理

  // 列出我的登录会话（每台设备一条），标注当前这台。
  app.get('/api/account/sessions', { preHandler: requireAuth() }, async (req) => {
    const list = store.sessionsForUser(req.user!.sub, Date.now())
    return { sessions: list.map((s) => ({ ...s, current: !!req.user!.sid && s.sessionId === req.user!.sid })) }
  })

  const sessionSchema = z.object({ sessionId: z.string().min(1) })

  // 远程登出某台设备（删除其会话；其 access token 经 requireAuth 的会话存活检查立即失效）。
  app.post('/api/account/sessions/revoke', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = sessionSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    // 本设备管理页语义是"登出**其它**设备"——不该经此吊销当前会话把自己踢下线（登出走登出、批量走 revoke-others）。
    // 服务端权威：两端 UI 已对当前会话隐藏登出按钮，这里再兜一层，防改造/未来客户端误踢当前会话。
    if (req.user!.sid && parsed.data.sessionId === req.user!.sid) return reply.code(400).send({ error: 'cannot_revoke_current' })
    store.revokeSession(req.user!.sub, parsed.data.sessionId)
    return { ok: true }
  })

  // 登出其它所有设备（保留当前这台）。被盗设备场景的标准响应——除吊销会话外**连带清其它浏览器的
  // 推送订阅**：否则小偷浏览器继续收告警/消息系统通知（会话死了推送订阅不死）。订阅与会话无关联
  // （Web Push endpoint 不含 sessionId），服务端无从辨"当前浏览器"——由客户端自带 keepEndpoint
  // （本浏览器 SW 的订阅端点）；不带（iOS 调用/无 SW）则清全部，本浏览器下次开设置页自愈重订。
  app.post('/api/account/sessions/revoke-others', { preHandler: requireAuth() }, async (req, reply) => {
    const sid = req.user!.sid
    if (!sid) return reply.code(400).send({ error: 'no_session' }) // 旧 token 无 sid，无法识别"当前"
    const keep = (req.body as { keepEndpoint?: string } | null)?.keepEndpoint
    store.revokeOtherSessions(req.user!.sub, sid)
    for (const sub of store.webPushSubscriptionsForUser(req.user!.sub)) {
      if (typeof keep === 'string' && sub.endpoint === keep) continue
      store.deleteWebPushSubscription(sub.endpoint)
    }
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

  // 记录对《隐私政策》《使用条款》的同意（注册门控 + GDPR 可证明同意）。客户端在完成注册前调用；
  // 文档版本随重大更新递增，客户端据此可在版本变化时要求重新同意。
  app.post('/api/account/legal-consent', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = z.object({ version: z.string().trim().min(1).max(16) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const updated = store.updateUser(req.user!.sub, { legalConsentVersion: parsed.data.version, legalConsentAt: Date.now() })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    return { ok: true, legalConsentVersion: updated.legalConsentVersion, legalConsentAt: updated.legalConsentAt }
  })

  // 绑定/换绑手机号（手机号+密码登录的标识）：归一化 + 全局唯一（不能占用他人手机号）。
  // 端级限流(与改密/2FA 同 10/min)：改手机/用户名都是**登录标识变更 + 每次真改都 notifySecurity 推送本人**——
  // 无限流则被盗令牌可循环改不同值(changed 恒真)刷爆本人安全推送(淹没真信号)、并放大写库。正常一次即可，10/min 极宽松。
  app.post('/api/account/phone', { preHandler: requireAuth(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = z.object({ phone: z.string().trim().min(6).max(20) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    const p = normalizePhone(parsed.data.phone)
    if (!p) return reply.code(400).send({ error: 'invalid_phone' })
    const existing = store.findByPhone(p)
    if (existing && existing.id !== user.id) return reply.code(409).send({ error: 'phone_taken' })
    const changed = user.phone !== p // 归一化后仍不同才算真的改动（重复提交同号不误报）
    const updated = store.updateUser(user.id, { phone: p })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    // 手机号是「手机号+密码」登录标识（findByLoginIdentifier 收），与改邮箱同属**接管账号常见第一步**——
    // 未授权换绑即时预警本人（首次绑定 undefined→号 也算变更；勿扰中经 security_* 越过，见 quietHours）。
    if (changed) notifySecurity(user, 'phone_changed')
    return { ok: true }
  })

  // 选择/更改身份角色（新账号引导统一在认证后选择，覆盖所有注册方式）。
  // 仅自助角色（blind/helper/family）之间可切换；admin/developer 由后台分配，不可经此自助变更或夺取。
  // requireAuth 的角色实时取自存储（非 JWT 声明），改角色无需换发令牌。
  app.post('/api/account/role', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = z.object({ role: z.enum(['blind', 'helper', 'family']) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    if (!['blind', 'helper', 'family'].includes(user.role)) {
      return reply.code(403).send({ error: 'role_not_self_service' }) // admin/developer 不可自助降级（防误锁后台）
    }
    const updated = store.updateUser(user.id, { role: parsed.data.role })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    return { role: updated.role }
  })

  // 修改/设置用户名（唯一登录标识）：校验格式 + 唯一性（大小写不敏感）；成功后标记 usernameCustomized=true。
  // access token 以 user id 为 sub，改用户名不影响现有令牌。用于 Apple/邮箱登录后自定义唯一 userid。
  app.post('/api/account/username', { preHandler: requireAuth(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = z.object({ username: z.string().trim().min(3).max(32) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const username = parsed.data.username
    if (!/^[A-Za-z0-9_.-]+$/.test(username)) return reply.code(400).send({ error: 'invalid_username' }) // 仅字母数字 _.- ，禁空白/混淆字符
    // 内容审核：与昵称/注册同口径——用户名 everyone 可见，违禁词不得塞进用户名绕过昵称过滤。
    if (matchBannedTerm(store.getAppConfig(), username)) return reply.code(403).send({ error: 'content_blocked' })
    const user = store.findById(req.user!.sub)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    const existing = store.findByUsername(username)
    if (existing && existing.id !== user.id) return reply.code(409).send({ error: 'username_taken' })
    const changed = user.username !== username // 仅真的改了才告警（重复提交同名不打扰）
    const updated = store.updateUser(user.id, { username, usernameCustomized: true })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    // 用户名是唯一登录标识（findByLoginIdentifier 收）——与改邮箱/手机号同属登录标识变更、潜在接管/锁定信号，即时预警本人。
    if (changed) notifySecurity(user, 'username_changed')
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
    const wasLinkedSame = user.appleSub === identity.sub // 已绑同一 Apple ID 的重复调用：无新增登录方式，不重复告警
    store.updateUser(user.id, patch)
    // 绑定 Apple 登录 = 给账号新增一条**免密登录方式**：若非本人操作，接管者据此可绕过改密持久登录——即时预警本人。
    if (!wasLinkedSame) notifySecurity(user, 'apple_linked')
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
    notifySecurity(user, 'apple_unlinked') // 移除一条登录方式亦属登录凭据变更，一致预警本人（接管者借解绑锁定原主）
    return { ok: true, appleLinked: false }
  })

  // 设置/更新邮箱（D1）：保存邮箱并标记未验证，随即发一封验证码邮件。
  // 限流：本端点会发验证码邮件。仅靠 codeSend 节流不够——其 check/record 夹着 await mailer.send，
  // 并发连发会在 record 前都过 check（绕过冷却）；而此端点（不同于 auth/email/request-code）此前无
  // fastify 限流兜底，故未实名攻击者可借并发向多个受害邮箱轰炸验证码。补 fastify 每分钟限流（在 onRequest
  // 钩子里同步计数、早于处理器，不受 codeSend 的 await 竞态影响），与 request-code 同口径 5/min 兜住突发。
  app.post('/api/account/email', { preHandler: requireAuth(),
                                   config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
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
    // 发送侧节流（防连点/轰炸）：按用户节流，超限则拒绝且不改邮箱。
    const sendKey = `send:verify:${user.id}`
    const sendAt = Date.now()
    // 原子占额：同步 check+record，消除「check→await 发信→record」的并发 TOCTOU（连发绕过冷却轰炸）。
    const dec = codeSend.tryConsume(sendKey, sendAt)
    if (!dec.ok) {
      reply.header('Retry-After', String(dec.retryAfterSec))
      return reply.code(429).send({ error: dec.reason === 'cooldown' ? 'code_cooldown' : 'code_too_many', retryAfterSec: dec.retryAfterSec })
    }
    const prev = { email: user.email, emailVerified: user.emailVerified }
    store.updateUser(user.id, { email, emailVerified: false })
    const code = codes.issue(`verify:${user.id}`, Date.now())
    try {
      const m = emailVerificationMail(code)
      await mailer.send(email, m.subject, m.text, m.html)
    } catch (e) {
      // 发信失败（SMTP 故障/凭据失效）：回滚邮箱变更 + 退还发送额度（不锁冷却），明确告知"邮件服务不可用"——
      // 不可发 500（客户端会误报网络错误），更不可假装已发送。
      store.updateUser(user.id, prev)
      codeSend.refund(sendKey, sendAt)
      console.warn('[mail] 验证码发送失败:', (e as Error).message)
      return reply.code(503).send({ error: 'mail_unavailable' })
    }
    notifySecurity(user, 'email_changed') // 邮箱已改（待验证）——未授权改邮箱是接管账号常见第一步，即时预警本人
    return { ok: true }
  })

  // 校验邮箱验证码（D1）：成功则标记 emailVerified=true。
  // 限流 10/min：本端点校验邮箱验证码，须与 auth/email/verify-code、2fa/enable 等**一切验证码端点同口径**加端点级限流
  // ——纵深防御（CodeRegistry 已限每码 5 次尝试，但端点级速率上限防连环换码猜测 + 端点被打；此前独漏本条，补齐一致性）。
  app.post('/api/account/email/verify', { preHandler: requireAuth(),
                                          config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
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
    if (matchBannedTerm(store.getAppConfig(), parsed.data.displayName)) return reply.code(403).send({ error: 'content_blocked' })
    if (!store.findById(req.user!.sub)) return reply.code(404).send({ error: 'not_found' })
    const updated = store.updateUser(req.user!.sub, { displayName: parsed.data.displayName })
    return { displayName: updated?.displayName }
  })

  // 设置头像（小尺寸 data URL；客户端压缩后上传）。
  // 限流 20/min：头像每次落库最多 600KB（整行重写），无端点级上限时全局 300/min 可放大成 ~180MB/min 写盘（写放大）；
  // 与相邻个人设置写端点（places/medical/family/quiet-hours 都有端点级限流）一致，且远超任何正常改头像频率。
  app.post('/api/account/avatar', { preHandler: requireAuth(),
                                    config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = avatarSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    if (!store.findById(req.user!.sub)) return reply.code(404).send({ error: 'not_found' })
    store.updateUser(req.user!.sub, { avatar: parsed.data.avatar })
    return { ok: true }
  })

  // 自助数据导出（GDPR 可携权 Art.20）：用户不求人拿走自己的数据。与 admin 代办导出共用底座
  // （防口径漂移），另加只有本人能拿的块：路线库 + **本人发出的**文字消息（对方的话不含——
  // 可携权不覆盖他人数据）。绝不含密码哈希/令牌（底座保证）。限流 3/小时：全量拉取偏重。
  app.get('/api/account/export', { preHandler: requireAuth(),
                                   config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (req, reply) => {
    const id = req.user!.sub
    const base = buildUserExportBundle(store, id, Date.now())
    if (!base) return reply.code(404).send({ error: 'not_found' })
    // 自助导出**只给"你拉黑了谁"(blocking)，不给"谁拉黑了你"(blockedBy)**：别人拉黑你＝那是别人的决定/数据
    // （在其自己的导出里作 blocking 出现），且向本人（可能正是被拉黑的骚扰方）披露"谁在躲你"有报复风险——对本应用
    // 的弱势用户（盲人/长者拉黑滥权照护者）尤甚。行业通例(IG/FB 的 GDPR 导出)亦只给前者。admin 版仍留 blockedBy（调查用）。
    const data = {
      ...base,
      blocks: { blocking: base.blocks.blocking },
      ...buildSelfExportExtras(store, id),
      note: 'Your own sent text messages are included; messages from others are not (their words are their data). Users who blocked you are not disclosed (that is their data). Voice/image/video messages list metadata only. Password hashes and tokens are never exported.',
    }
    reply.header('content-disposition', `attachment; filename="beeurei-my-data.json"`)
    return data
  })

  // 删除账号（App Store 要求）：删除用户 + 其亲友绑定(双向) + refresh token。
  app.delete('/api/account', { preHandler: requireAuth() }, async (req, reply) => {
    // 自助删号（GDPR 删除权）：级联清群/消息/绑定/Passkey/会话，不留孤儿数据。
    cascadeDeleteUser(store, req.user!.sub)
    return reply.code(204).send()
  })
}
