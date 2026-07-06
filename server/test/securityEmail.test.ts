import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import type { Mailer } from '../src/mail/mailer'
import { CodeSendLimiter } from '../src/auth/sendLimiter'

// 带外安全邮件告警：账号安全变更除 App 内+推送外，再发一封到本人已验证邮箱（攻击者持会话令牌通常不掌握邮箱）。
const noThrottle = () => new CodeSendLimiter(0, 60_000, 1000)
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

class CollectMailer implements Mailer {
  sent: { to: string; subject: string; text: string; html?: string }[] = []
  async send(to: string, subject: string, text: string, html?: string): Promise<void> { this.sent.push({ to, subject, text, html }) }
  codeFor(to: string): string { return [...this.sent].reverse().find((m) => m.to === to)?.text.match(/\d{6}/)?.[0] ?? '' }
}

async function setup() {
  const mailer = new CollectMailer()
  const app = buildApp(new MemoryStore(), { mailer, codeSend: noThrottle() })
  const reg = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'alice', password: 'strong-pass-9x', role: 'blind' } })).json()
  return { app, mailer, h: auth(reg.token) }
}
async function setVerifiedEmail(app: ReturnType<typeof buildApp>, mailer: CollectMailer, h: Record<string, string>, email: string) {
  await app.inject({ method: 'POST', url: '/api/account/email', headers: h, payload: { email } })
  await app.inject({ method: 'POST', url: '/api/account/email/verify', headers: h, payload: { code: mailer.codeFor(email) } })
}

describe('账号安全变更 → 带外邮件告警本人已验证邮箱', () => {
  it('改密 → 已验证邮箱收到安全邮件(点明"密码已修改" + 抢救指引)', async () => {
    const { app, mailer, h } = await setup()
    await setVerifiedEmail(app, mailer, h, 'alice@example.com')
    mailer.sent.length = 0
    const res = await app.inject({ method: 'POST', url: '/api/account/password', headers: h, payload: { oldPassword: 'strong-pass-9x', newPassword: 'fresh-pass-42x' } })
    expect(res.statusCode).toBe(200)
    const mail = mailer.sent.find((m) => m.to === 'alice@example.com')
    expect(mail).toBeTruthy()
    expect(mail!.subject).toMatch(/密码|password/i)
    expect(mail!.text).toMatch(/密码.*修改|Password changed/i)
    expect(mail!.text).toMatch(/重置密码|reset your password/i) // 抢救指引
    await app.close()
  })

  it('无已验证邮箱 → 不发安全邮件(仅 App 内+推送，避免打扰未必属本人的地址)', async () => {
    const { app, mailer, h } = await setup()
    // 设了邮箱但**未验证**
    await app.inject({ method: 'POST', url: '/api/account/email', headers: h, payload: { email: 'unverified@example.com' } })
    mailer.sent.length = 0
    await app.inject({ method: 'POST', url: '/api/account/password', headers: h, payload: { oldPassword: 'strong-pass-9x', newPassword: 'fresh-pass-42x' } })
    expect(mailer.sent).toHaveLength(0) // 邮箱未验证 → 不发带外安全邮件
    await app.close()
  })

  it('改用户名(另一 security_* 事件)也发安全邮件——整个 security_* 家族一致覆盖', async () => {
    const { app, mailer, h } = await setup()
    await setVerifiedEmail(app, mailer, h, 'bob@example.com')
    mailer.sent.length = 0
    const res = await app.inject({ method: 'POST', url: '/api/account/username', headers: h, payload: { username: 'alice2' } })
    expect(res.statusCode).toBe(200)
    const mail = mailer.sent.find((m) => m.to === 'bob@example.com')
    expect(mail).toBeTruthy()
    expect(mail!.subject).toMatch(/用户名|username/i)
    await app.close()
  })

  it('新设备登录 → 已验证邮箱收到"新设备登录"安全邮件(含设备名，供本人辨识)', async () => {
    const { app, mailer, h } = await setup()
    await setVerifiedEmail(app, mailer, h, 'carol@example.com')
    mailer.sent.length = 0
    // 从"另一台设备"登录（deviceName 不同于注册会话的空标签）→ 触发新设备预警。
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password: 'strong-pass-9x', deviceName: 'New Laptop' } })
    expect(res.statusCode).toBe(200)
    const mail = mailer.sent.find((m) => m.to === 'carol@example.com')
    expect(mail).toBeTruthy()
    expect(mail!.subject).toMatch(/新设备登录|New sign-in/i)
    expect(mail!.text).toContain('New Laptop') // 含设备名
    await app.close()
  })

  it('新设备名含 HTML → 邮件 HTML 转义(deviceName 用户可控，防邮件注入)', async () => {
    const { app, mailer, h } = await setup()
    await setVerifiedEmail(app, mailer, h, 'dave@example.com')
    mailer.sent.length = 0
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password: 'strong-pass-9x', deviceName: '<script>evil()</script>' } })
    const mail = mailer.sent.find((m) => m.to === 'dave@example.com')
    expect(mail).toBeTruthy()
    expect(mail!.html).toBeTruthy()
    expect(mail!.html).not.toContain('<script>evil')   // 原样标签绝不进 HTML
    expect(mail!.html).toContain('&lt;script&gt;')      // 已转义
    await app.close()
  })

  it('email_changed 特例：安全邮件不发到新(未验证)邮箱；旧邮箱仍收专门的改邮箱告警', async () => {
    const { app, mailer, h } = await setup()
    await setVerifiedEmail(app, mailer, h, 'old@example.com')
    mailer.sent.length = 0
    await app.inject({ method: 'POST', url: '/api/account/email', headers: h, payload: { email: 'attacker@evil.com' } })
    // 旧邮箱：收到"邮箱已更改"告警（emailChangedAlertMail）。
    expect(mailer.sent.some((m) => m.to === 'old@example.com' && /已更改|changed/i.test(m.subject))).toBe(true)
    // 新(未验证)邮箱：只收验证码，绝不收到"邮箱已更改"这类安全告警（否则等于把告警发给攻击者刚设的地址）。
    expect(mailer.sent.some((m) => m.to === 'attacker@evil.com' && /已更改|changed/i.test(m.subject))).toBe(false)
    await app.close()
  })
})
