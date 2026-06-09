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
const tick = () => new Promise((r) => setTimeout(r, 30)) // 让 fire-and-forget 发信的微/宏任务完成

// 绑定并验证邮箱（forgot 现在要求邮箱已验证，见审查 #8）。
async function verifyEmail(app: ReturnType<typeof buildApp>, token: string, email: string, sent: { text: string }[]) {
  await app.inject({ method: 'POST', url: '/api/account/email', headers: auth(token), payload: { email } })
  const code = codeOf(sent[sent.length - 1].text) // setEmail 同步 await 发信，已在 sent 里
  await app.inject({ method: 'POST', url: '/api/account/email/verify', headers: auth(token), payload: { code } })
}

describe('邮箱验证 / 找回密码 (D1)', () => {
  it('注册带邮箱 → /me 反映邮箱与未验证状态', async () => {
    const { app } = capturingApp()
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'mailA', password: 'secret123', email: 'A@Example.com' } })
    expect(reg.statusCode).toBe(201)
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(reg.json().token) })
    expect(me.json().user.email).toBe('a@example.com') // 规范化为小写（见审查 #13）
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
    const bad = await app.inject({ method: 'POST', url: '/api/account/email/verify', headers: auth(token), payload: { code: '000000' } })
    expect(bad.statusCode).toBe(400)
    const ok = await app.inject({ method: 'POST', url: '/api/account/email/verify', headers: auth(token), payload: { code: codeOf(sent[0].text) } })
    expect(ok.statusCode).toBe(200)
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) })
    expect(me.json().user.emailVerified).toBe(true)
    await app.close()
  })

  it('邮箱唯一：不能设成他人已用邮箱（见审查 #13）', async () => {
    const { app } = capturingApp()
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'owner1', password: 'secret123', email: 'dup@example.com' } })
    const reg2 = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'other1', password: 'secret123' } })
    const conflict = await app.inject({ method: 'POST', url: '/api/account/email', headers: auth(reg2.json().token), payload: { email: 'DUP@example.com' } })
    expect(conflict.statusCode).toBe(409)
    // 注册时撞邮箱同样 409
    const regDup = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'other2', password: 'secret123', email: 'dup@example.com' } })
    expect(regDup.statusCode).toBe(409)
    await app.close()
  })

  it('找回密码：已验证邮箱发码 → 重置 → 新密码可登录、旧密码失效', async () => {
    const { app, sent } = capturingApp()
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'mailC', password: 'oldpass123' } })
    await verifyEmail(app, reg.json().token, 'c@example.com', sent)

    const forgot = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { username: 'mailC' } })
    expect(forgot.statusCode).toBe(200)
    await tick()
    const resetMail = sent[sent.length - 1]
    expect(resetMail.subject).toContain('重置密码')
    const code = codeOf(resetMail.text)

    const bad = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { username: 'mailC', code: '111111', newPassword: 'newpass123' } })
    expect(bad.statusCode).toBe(400)
    const reset = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { username: 'mailC', code, newPassword: 'newpass123' } })
    expect(reset.statusCode).toBe(200)

    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'mailC', password: 'newpass123' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'mailC', password: 'oldpass123' } })).statusCode).toBe(401)
    await app.close()
  })

  it('未验证邮箱不发重置码（见审查 #8）', async () => {
    const { app, sent } = capturingApp()
    // 注册带邮箱但从不验证
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'mailU', password: 'secret123', email: 'u@example.com' } })
    const forgot = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { username: 'mailU' } })
    expect(forgot.statusCode).toBe(200) // 仍返回 ok，防枚举
    await tick()
    expect(sent.length).toBe(0) // 但不发码
    await app.close()
  })

  it('不做用户枚举：无邮箱/不存在用户 forgot 也返回 200 且不发信', async () => {
    const { app, sent } = capturingApp()
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'noEmail', password: 'secret123' } })
    expect((await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { username: 'noEmail' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { username: 'ghost' } })).statusCode).toBe(200)
    await tick()
    expect(sent.length).toBe(0)
    await app.close()
  })

  it('重置码一次性消费：用过即失效', async () => {
    const { app, sent } = capturingApp()
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'mailD', password: 'oldpass123' } })
    await verifyEmail(app, reg.json().token, 'd@example.com', sent)
    await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { username: 'mailD' } })
    await tick()
    const code = codeOf(sent[sent.length - 1].text)
    expect((await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { username: 'mailD', code, newPassword: 'newpass123' } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { username: 'mailD', code, newPassword: 'another123' } })).statusCode).toBe(400)
    await app.close()
  })
})
