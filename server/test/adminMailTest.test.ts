import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type User } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'
import type { Mailer } from '../src/mail/mailer'

class CapturingMailer implements Mailer {
  sent: { to: string; subject: string }[] = []
  async send(to: string, subject: string): Promise<void> { this.sent.push({ to, subject }) }
}
class ThrowingMailer implements Mailer {
  async send(): Promise<void> { throw new Error('535 authentication failed (163 授权码过期)') }
}

function setup(mailer: Mailer, adminPatch: Partial<User> = {}) {
  const store = new MemoryStore()
  store.createUser({ id: 'admin1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: 1, ...adminPatch })
  return { store, app: buildApp(store, { mailer }) }
}
const login = async (app: ReturnType<typeof buildApp>) =>
  (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token as string

describe('POST /api/admin/mail-test（SMTP 自检）', () => {
  it('指定收件人 → 发出测试邮件、200 ok（运维配好 SMTP 后当场验证）', async () => {
    const mailer = new CapturingMailer()
    const { app } = setup(mailer)
    const t = await login(app)
    const res = await app.inject({ method: 'POST', url: '/api/admin/mail-test', headers: { authorization: `Bearer ${t}` }, payload: { to: 'ops@example.com' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0].to).toBe('ops@example.com')
    expect(mailer.sent[0].subject).toContain('SMTP')
    await app.close()
  })

  it('缺收件人回落本人**已验证**邮箱；未验证/无邮箱 → 400 no_recipient（不发到打错的地址）', async () => {
    // 本人邮箱已验证 → 缺 to 时发到本人。
    const mailer = new CapturingMailer()
    const { app } = setup(mailer, { email: 'root@corp.com', emailVerified: true })
    const t = await login(app)
    expect((await app.inject({ method: 'POST', url: '/api/admin/mail-test', headers: { authorization: `Bearer ${t}` }, payload: {} })).statusCode).toBe(200)
    expect(mailer.sent[0].to).toBe('root@corp.com')
    await app.close()
    // 本人无已验证邮箱 + 未指定 to → 400。
    const { app: app2 } = setup(new CapturingMailer())
    const t2 = await login(app2)
    const r = await app2.inject({ method: 'POST', url: '/api/admin/mail-test', headers: { authorization: `Bearer ${t2}` }, payload: {} })
    expect(r.statusCode).toBe(400)
    expect(r.json().error).toBe('no_recipient')
    await app2.close()
  })

  it('SMTP 报错 → 502 mail_failed + detail 回上游报错（管理员据此诊断 163 授权码等）', async () => {
    const { app } = setup(new ThrowingMailer())
    const t = await login(app)
    const res = await app.inject({ method: 'POST', url: '/api/admin/mail-test', headers: { authorization: `Bearer ${t}` }, payload: { to: 'ops@example.com' } })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toBe('mail_failed')
    expect(res.json().detail).toContain('535') // 上游报错如实回给管理员诊断
    await app.close()
  })

  it('发信失败后 admin 总览 mail.lastError 显示原因（运维一眼知"为什么发不出去"，不必 SSH 翻日志）', async () => {
    const { app } = setup(new ThrowingMailer())
    const t = await login(app)
    const headers = { authorization: `Bearer ${t}` }
    // 初始：无失败、无原因。
    const ov0 = (await app.inject({ method: 'GET', url: '/api/admin/overview', headers })).json()
    expect(ov0.mail.failed).toBe(0)
    expect(ov0.mail.lastError).toBeNull()
    // 一次失败的发信（mail-test 撞 535）→ 失败计数 +1 且原因入便签。
    await app.inject({ method: 'POST', url: '/api/admin/mail-test', headers, payload: { to: 'ops@example.com' } })
    const ov1 = (await app.inject({ method: 'GET', url: '/api/admin/overview', headers })).json()
    expect(ov1.mail.failed).toBe(1)
    expect(ov1.mail.lastError).toContain('535')        // 原因回带到面板
    expect(typeof ov1.mail.lastErrorAt).toBe('number')
    await app.close()
  })

  it('非管理员 403；非法邮箱 400', async () => {
    const { app } = setup(new CapturingMailer())
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bob', password: 'secret123' } })
    expect((await app.inject({ method: 'POST', url: '/api/admin/mail-test', headers: { authorization: `Bearer ${reg.json().token}` }, payload: { to: 'x@y.com' } })).statusCode).toBe(403)
    const t = await login(app)
    expect((await app.inject({ method: 'POST', url: '/api/admin/mail-test', headers: { authorization: `Bearer ${t}` }, payload: { to: '不是邮箱' } })).statusCode).toBe(400)
    await app.close()
  })
})
