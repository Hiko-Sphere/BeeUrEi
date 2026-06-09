import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import type { Mailer } from '../src/mail/mailer'

function capturingApp() {
  const sent: { to: string; subject: string; text: string }[] = []
  const mailer: Mailer = { async send(to, subject, text) { sent.push({ to, subject, text }) } }
  return { app: buildApp(new MemoryStore(), { mailer }), sent }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const codeOf = (text: string) => text.match(/(\d{6})/)?.[1] ?? ''

describe('邮箱验证 / 找回密码 (D1)', () => {
  it('注册带邮箱 → /me 反映邮箱与未验证状态', async () => {
    const { app } = capturingApp()
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'mailA', password: 'secret123', email: 'a@example.com' } })
    expect(reg.statusCode).toBe(201)
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(reg.json().token) })
    expect(me.json().user.email).toBe('a@example.com')
    expect(me.json().user.emailVerified).toBe(false)
    await app.close()
  })

  it('设置邮箱 → 收到验证码 → 验证成功后 emailVerified=true', async () => {
    const { app, sent } = capturingApp()
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'mailB', password: 'secret123' } })
    const token = reg.json().token
    const set = await app.inject({ method: 'POST', url: '/api/account/email', headers: auth(token), payload: { email: 'b@example.com' } })
    expect(set.statusCode).toBe(200)
    expect(sent.length).toBe(1)
    expect(sent[0].to).toBe('b@example.com')
    const code = codeOf(sent[0].text)

    const bad = await app.inject({ method: 'POST', url: '/api/account/email/verify', headers: auth(token), payload: { code: '000000' } })
    expect(bad.statusCode).toBe(400)

    const ok = await app.inject({ method: 'POST', url: '/api/account/email/verify', headers: auth(token), payload: { code } })
    expect(ok.statusCode).toBe(200)
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) })
    expect(me.json().user.emailVerified).toBe(true)
    await app.close()
  })

  it('找回密码：发码 → 重置 → 新密码可登录、旧密码失效', async () => {
    const { app, sent } = capturingApp()
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'mailC', password: 'oldpass123', email: 'c@example.com' } })

    const forgot = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { username: 'mailC' } })
    expect(forgot.statusCode).toBe(200)
    expect(sent.length).toBe(1)
    const code = codeOf(sent[0].text)

    // 错误码 → 400
    const bad = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { username: 'mailC', code: '111111', newPassword: 'newpass123' } })
    expect(bad.statusCode).toBe(400)

    const reset = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { username: 'mailC', code, newPassword: 'newpass123' } })
    expect(reset.statusCode).toBe(200)

    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'mailC', password: 'newpass123' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'mailC', password: 'oldpass123' } })).statusCode).toBe(401)
    await app.close()
  })

  it('不做用户枚举：无邮箱用户/不存在用户 forgot 也返回 200 且不发信', async () => {
    const { app, sent } = capturingApp()
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'noEmail', password: 'secret123' } })
    expect((await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { username: 'noEmail' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { username: 'ghost' } })).statusCode).toBe(200)
    expect(sent.length).toBe(0)
    await app.close()
  })

  it('重置码一次性消费：用过即失效', async () => {
    const { app, sent } = capturingApp()
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'mailD', password: 'oldpass123', email: 'd@example.com' } })
    await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { username: 'mailD' } })
    const code = codeOf(sent[0].text)
    expect((await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { username: 'mailD', code, newPassword: 'newpass123' } })).statusCode).toBe(200)
    // 同一码二次使用失败
    expect((await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { username: 'mailD', code, newPassword: 'another123' } })).statusCode).toBe(400)
    await app.close()
  })
})
