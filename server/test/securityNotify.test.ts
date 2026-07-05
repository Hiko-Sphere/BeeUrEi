import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type Store } from '../src/db/store'
import { totpAt } from '../src/auth/totp'
import type { Mailer } from '../src/mail/mailer'
import type { AppleTokenVerifier } from '../src/auth/apple'

// 测试用 Apple 验签：'good:SUB:email' → { sub, email }（与 authOverhaul.test 同款）。
const fakeApple: AppleTokenVerifier = async (t) => {
  if (!t.startsWith('good:')) return null
  const [, sub, email] = t.split(':')
  return { sub, email: email || undefined }
}

// 账号安全敏感变更 → 通知本人（未授权变更即时预警；industry-standard "密码已修改"）。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const codeOf = (text: string) => text.match(/(\d{6})/)?.[1] ?? ''
const secKinds = (store: Store, uid: string) => store.notificationsForUser(uid).filter((n) => n.kind.startsWith('security_')).map((n) => n.kind)

function capturingApp() {
  const sent: { to: string; subject: string; text: string }[] = []
  const mailer: Mailer = { async send(to, subject, text) { sent.push({ to, subject, text }) } }
  const store = new MemoryStore()
  return { app: buildApp(store, { mailer, appleVerifier: fakeApple }), store, sent }
}
const reg = async (app: ReturnType<typeof buildApp>, username: string, email?: string) =>
  (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'strong-pass-9x', ...(email ? { email } : {}) } })).json()

describe('账号安全变更预警本人', () => {
  it('改密 → security_password_changed（且正文提示"若非本人操作"）', async () => {
    const { app, store } = capturingApp()
    const r = await reg(app, 'secpw')
    const res = await app.inject({ method: 'POST', url: '/api/account/password', headers: auth(r.token),
      payload: { oldPassword: 'strong-pass-9x', newPassword: 'another-strong-8y' } })
    expect(res.statusCode).toBe(200)
    expect(secKinds(store, r.user.id)).toEqual(['security_password_changed'])
    const n = store.notificationsForUser(r.user.id).find((x) => x.kind === 'security_password_changed')!
    expect(n.body).toContain('若非本人操作')
    await app.close()
  })

  it('改邮箱 → security_email_changed', async () => {
    const { app, store } = capturingApp()
    const r = await reg(app, 'secem')
    await app.inject({ method: 'POST', url: '/api/account/email', headers: auth(r.token), payload: { email: 'new@example.com' } })
    expect(secKinds(store, r.user.id)).toContain('security_email_changed')
    await app.close()
  })

  it('换绑手机号 → security_phone_changed（登录标识变更即时预警；重复提交同号不重复报）', async () => {
    const { app, store } = capturingApp()
    const r = await reg(app, 'secph')
    // 首次绑定：undefined → 号，算变更 → 预警
    const first = await app.inject({ method: 'POST', url: '/api/account/phone', headers: auth(r.token), payload: { phone: '+1 (555) 010-2020' } })
    expect(first.statusCode).toBe(200)
    expect(secKinds(store, r.user.id)).toEqual(['security_phone_changed'])
    // 重复提交同一号码（含不同格式但归一化相同）：无变更 → 不再报
    const again = await app.inject({ method: 'POST', url: '/api/account/phone', headers: auth(r.token), payload: { phone: '+15550102020' } })
    expect(again.statusCode).toBe(200)
    expect(secKinds(store, r.user.id)).toEqual(['security_phone_changed']) // 仍只有一条
    // 换成新号：再次预警
    await app.inject({ method: 'POST', url: '/api/account/phone', headers: auth(r.token), payload: { phone: '+15550103030' } })
    expect(secKinds(store, r.user.id).filter((k) => k === 'security_phone_changed')).toHaveLength(2)
    await app.close()
  })

  it('改用户名 → security_username_changed（登录标识变更；重复同名不重复报）', async () => {
    const { app, store } = capturingApp()
    const r = await reg(app, 'secun')
    const first = await app.inject({ method: 'POST', url: '/api/account/username', headers: auth(r.token), payload: { username: 'newname_x' } })
    expect(first.statusCode).toBe(200)
    expect(secKinds(store, r.user.id)).toEqual(['security_username_changed'])
    // 重复提交同一用户名：无变更 → 不再报
    const again = await app.inject({ method: 'POST', url: '/api/account/username', headers: auth(r.token), payload: { username: 'newname_x' } })
    expect(again.statusCode).toBe(200)
    expect(secKinds(store, r.user.id)).toEqual(['security_username_changed'])
    await app.close()
  })

  it('绑定/解绑 Apple 登录 → security_apple_linked / security_apple_unlinked（重复绑同一 ID 不重复报）', async () => {
    const { app, store } = capturingApp()
    const r = await reg(app, 'secap') // 用户名+密码账号
    const link = await app.inject({ method: 'POST', url: '/api/account/apple', headers: auth(r.token), payload: { identityToken: 'good:SUBAP:ap@icloud.com' } })
    expect(link.statusCode).toBe(200)
    expect(secKinds(store, r.user.id)).toContain('security_apple_linked')
    // 重复绑定同一 Apple ID：无新增登录方式 → 不重复告警
    await app.inject({ method: 'POST', url: '/api/account/apple', headers: auth(r.token), payload: { identityToken: 'good:SUBAP:ap@icloud.com' } })
    expect(secKinds(store, r.user.id).filter((k) => k === 'security_apple_linked')).toHaveLength(1)
    // 解绑（绑定顺带写入了已验证 Apple 邮箱=另一登录方式，故可解绑）→ apple_unlinked
    const unlink = await app.inject({ method: 'DELETE', url: '/api/account/apple', headers: auth(r.token) })
    expect(unlink.statusCode).toBe(200)
    expect(secKinds(store, r.user.id)).toContain('security_apple_unlinked')
    await app.close()
  })

  it('开/关 2FA → security_2fa_enabled / security_2fa_disabled', async () => {
    const { app, store } = capturingApp()
    const r = await reg(app, 'sec2fa')
    const setup = (await app.inject({ method: 'POST', url: '/api/account/2fa/setup', headers: auth(r.token) })).json()
    const en = (await app.inject({ method: 'POST', url: '/api/account/2fa/enable', headers: auth(r.token), payload: { code: totpAt(setup.secret, Date.now()) } })).json()
    expect(secKinds(store, r.user.id)).toContain('security_2fa_enabled')
    // 用恢复码关闭（同窗口 TOTP 已被 enable 单次消费，会被防重放拒；恢复码是另一有效第二因子）。
    await app.inject({ method: 'POST', url: '/api/account/2fa/disable', headers: auth(r.token), payload: { code: en.recoveryCodes[0] } })
    expect(secKinds(store, r.user.id)).toContain('security_2fa_disabled')
    await app.close()
  })

  it('重新生成恢复码 → security_2fa_recovery_regenerated（换一种登录凭据须预警本人）', async () => {
    const { app, store } = capturingApp()
    const r = await reg(app, 'secrecov')
    const setup = (await app.inject({ method: 'POST', url: '/api/account/2fa/setup', headers: auth(r.token) })).json()
    const en = (await app.inject({ method: 'POST', url: '/api/account/2fa/enable', headers: auth(r.token), payload: { code: totpAt(setup.secret, Date.now()) } })).json()
    // 用恢复码过二次验证来重生成（enable 已消费同窗 TOTP，防重放会拒之）。
    const regen = await app.inject({ method: 'POST', url: '/api/account/2fa/recovery-codes', headers: auth(r.token), payload: { code: en.recoveryCodes[0] } })
    expect(regen.statusCode).toBe(200)
    expect(regen.json().recoveryCodes.length).toBeGreaterThan(0)
    expect(secKinds(store, r.user.id)).toContain('security_2fa_recovery_regenerated') // 换恢复码亦预警本人
    const n = store.notificationsForUser(r.user.id).find((x) => x.kind === 'security_2fa_recovery_regenerated')!
    expect(n.body).toMatch(/若非本人操作|wasn/i) // 正文含"若非本人操作"提示
    await app.close()
  })

  it('找回密码重置 → security_password_reset', async () => {
    const { app, store, sent } = capturingApp()
    const r = await reg(app, 'secrst')
    // 绑定并验证邮箱（forgot 要求已验证）——这会顺带产生一条 email_changed，不影响本断言。
    await app.inject({ method: 'POST', url: '/api/account/email', headers: auth(r.token), payload: { email: 'r@example.com' } })
    await app.inject({ method: 'POST', url: '/api/account/email/verify', headers: auth(r.token), payload: { code: codeOf(sent[sent.length - 1].text) } })
    await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { username: 'secrst' } })
    const resetCode = codeOf(sent[sent.length - 1].text)
    const res = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { username: 'secrst', code: resetCode, newPassword: 'reset-strong-7z' } })
    expect(res.statusCode).toBe(200)
    expect(secKinds(store, r.user.id)).toContain('security_password_reset')
    await app.close()
  })

  it('用户语言随收件人（英文用户收英文预警）', async () => {
    const { app, store } = capturingApp()
    const r = await reg(app, 'seclang')
    store.updateUser(r.user.id, { language: 'en' })
    await app.inject({ method: 'POST', url: '/api/account/password', headers: auth(r.token),
      payload: { oldPassword: 'strong-pass-9x', newPassword: 'another-strong-8y' } })
    const n = store.notificationsForUser(r.user.id).find((x) => x.kind === 'security_password_changed')!
    expect(n.title).toBe('Password changed')
    await app.close()
  })
})
