import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import type { Mailer } from '../src/mail/mailer'
import { CodeSendLimiter } from '../src/auth/sendLimiter'

// 同一用户连发多次改邮箱码，注入无冷却节流器隔离发送节流逻辑（与 authOverhaul.test 同法）。
const noThrottle = () => new CodeSendLimiter(0, 60_000, 1000)
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

// 收集全部外发邮件（一次改邮箱请求会同时发"新邮箱验证码"+"旧邮箱告警"两封，CaptureMailer 只留最后一封不够用）。
class CollectMailer implements Mailer {
  sent: { to: string; subject: string; text: string }[] = []
  async send(to: string, subject: string, text: string): Promise<void> { this.sent.push({ to, subject, text }) }
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

describe('改邮箱告警旧邮箱（账号接管防线）', () => {
  it('从已验证旧邮箱改走 → 旧邮箱收到告警(含新地址)，新邮箱收到验证码', async () => {
    const { app, mailer, h } = await setup()
    await setVerifiedEmail(app, mailer, h, 'old@example.com')
    mailer.sent.length = 0
    const res = await app.inject({ method: 'POST', url: '/api/account/email', headers: h, payload: { email: 'new@example.com' } })
    expect(res.statusCode).toBe(200)
    // 新邮箱：收到验证码（改邮箱主流程照常）。
    expect(mailer.sent.some((m) => m.to === 'new@example.com')).toBe(true)
    // 旧邮箱：收到安全告警，含新地址、点明"邮箱已更改"。
    const alert = mailer.sent.find((m) => m.to === 'old@example.com')
    expect(alert).toBeTruthy()
    expect(alert!.subject).toMatch(/已更改|changed/i)
    expect(alert!.text).toContain('new@example.com')
    await app.close()
  })

  it('旧邮箱未验证 → 不告警(避免打扰未必属本人的地址)，新邮箱仍收验证码', async () => {
    const { app, mailer, h } = await setup()
    await app.inject({ method: 'POST', url: '/api/account/email', headers: h, payload: { email: 'unverified@example.com' } }) // 设但不验证
    mailer.sent.length = 0
    await app.inject({ method: 'POST', url: '/api/account/email', headers: h, payload: { email: 'next@example.com' } })
    expect(mailer.sent.some((m) => m.to === 'unverified@example.com')).toBe(false) // 未验证旧邮箱不告警
    expect(mailer.sent.some((m) => m.to === 'next@example.com')).toBe(true)        // 新邮箱验证码照发
    await app.close()
  })

  it('首次设邮箱(无旧邮箱) → 无告警', async () => {
    const { app, mailer, h } = await setup()
    await app.inject({ method: 'POST', url: '/api/account/email', headers: h, payload: { email: 'first@example.com' } })
    expect(mailer.sent.filter((m) => /已更改|changed/i.test(m.subject))).toHaveLength(0)
    await app.close()
  })

  it('改回同一(已验证)地址 → 不告警(未真正换走)', async () => {
    const { app, mailer, h } = await setup()
    await setVerifiedEmail(app, mailer, h, 'same@example.com')
    mailer.sent.length = 0
    await app.inject({ method: 'POST', url: '/api/account/email', headers: h, payload: { email: 'same@example.com' } })
    expect(mailer.sent.filter((m) => /已更改|changed/i.test(m.subject))).toHaveLength(0)
    await app.close()
  })
})
