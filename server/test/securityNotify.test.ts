import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type Store } from '../src/db/store'
import { totpAt } from '../src/auth/totp'
import type { Mailer } from '../src/mail/mailer'

// 账号安全敏感变更 → 通知本人（未授权变更即时预警；industry-standard "密码已修改"）。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const codeOf = (text: string) => text.match(/(\d{6})/)?.[1] ?? ''
const secKinds = (store: Store, uid: string) => store.notificationsForUser(uid).filter((n) => n.kind.startsWith('security_')).map((n) => n.kind)

function capturingApp() {
  const sent: { to: string; subject: string; text: string }[] = []
  const mailer: Mailer = { async send(to, subject, text) { sent.push({ to, subject, text }) } }
  const store = new MemoryStore()
  return { app: buildApp(store, { mailer }), store, sent }
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
