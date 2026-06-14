import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import type { Mailer } from '../src/mail/mailer'
import type { AppleTokenVerifier } from '../src/auth/apple'
import { CodeSendLimiter } from '../src/auth/sendLimiter'

// 这些用例本就要为同一收件人连发多次码（验证"再次发码即登录同账号"等），故注入无冷却节流器隔离发送节流逻辑。
const noThrottle = () => new CodeSendLimiter(0, 60_000, 1000)

const auth = (t: string) => ({ authorization: `Bearer ${t}` })

/// 捕获邮件以读取验证码（路由内部生成码，测试经此拿到明文）。
class CaptureMailer implements Mailer {
  last?: { to: string; subject: string; text: string }
  async send(to: string, subject: string, text: string): Promise<void> { this.last = { to, subject, text } }
  code(): string { return this.last?.text.match(/\d{4,8}/)?.[0] ?? '' }
}

/// fake Apple 验证器：token 形如 good:<sub> 或 good:<sub>:<email>。
const fakeApple: AppleTokenVerifier = async (t) => {
  if (!t.startsWith('good:')) return null
  const [, sub, email] = t.split(':')
  return { sub, email: email || undefined }
}

describe('邮箱验证码登录/注册（无密码）', () => {
  it('新邮箱建号（usernameCustomized=false、邮箱已验证），再次发码即登录同账号', async () => {
    const mailer = new CaptureMailer()
    const app = buildApp(new MemoryStore(), { mailer, codeSend: noThrottle() })

    const req1 = await app.inject({ method: 'POST', url: '/api/auth/email/request-code', payload: { email: 'New@Example.com' } })
    expect(req1.statusCode).toBe(200)
    const v1 = await app.inject({ method: 'POST', url: '/api/auth/email/verify-code',
      payload: { email: 'new@example.com', code: mailer.code() } })
    expect(v1.statusCode).toBe(201)
    const body1 = v1.json() as any
    expect(body1.token).toBeTruthy()
    expect(body1.user.username).toMatch(/^user_/)

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(body1.token) })
    const meBody = (me.json() as any).user
    expect(meBody.usernameCustomized).toBe(false) // 提示用户自定义 userid
    expect(meBody.emailVerified).toBe(true)
    expect(meBody.email).toBe('new@example.com')

    // 已存在邮箱 → 登录同一账号
    await app.inject({ method: 'POST', url: '/api/auth/email/request-code', payload: { email: 'new@example.com' } })
    const v2 = await app.inject({ method: 'POST', url: '/api/auth/email/verify-code',
      payload: { email: 'new@example.com', code: mailer.code() } })
    expect(v2.statusCode).toBe(200)
    expect((v2.json() as any).user.id).toBe(body1.user.id)

    // 验证码用后即焚：再次用同码 400
    const reuse = await app.inject({ method: 'POST', url: '/api/auth/email/verify-code',
      payload: { email: 'new@example.com', code: mailer.code() } })
    expect(reuse.statusCode).toBe(400)
  })

  it('发码端点防枚举：无论邮箱是否存在都返回 ok', async () => {
    const app = buildApp(new MemoryStore(), { codeSend: noThrottle() })
    const r = await app.inject({ method: 'POST', url: '/api/auth/email/request-code', payload: { email: 'ghost@nowhere.com' } })
    expect(r.statusCode).toBe(200)
    expect((r.json() as any).ok).toBe(true)
  })
})

describe('自定义/修改用户名', () => {
  it('唯一 + 格式校验，成功后标记 usernameCustomized 并可用新名登录', async () => {
    const app = buildApp(new MemoryStore(), { codeSend: noThrottle() })
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { password: 'secret123', email: 'u1@example.com' } })
    const token = (r.json() as any).token

    const me0 = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) })
    expect((me0.json() as any).user.usernameCustomized).toBe(false) // 自动生成名

    const set = await app.inject({ method: 'POST', url: '/api/account/username', headers: auth(token), payload: { username: 'cool.name' } })
    expect(set.statusCode).toBe(200)
    const me1 = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) })
    expect((me1.json() as any).user.usernameCustomized).toBe(true)
    expect((me1.json() as any).user.username).toBe('cool.name')

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'cool.name', password: 'secret123' } })
    expect(login.statusCode).toBe(200)

    const bad = await app.inject({ method: 'POST', url: '/api/account/username', headers: auth(token), payload: { username: 'has space' } })
    expect(bad.statusCode).toBe(400)

    const other = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'taken1', password: 'secret123' } })
    expect(other.statusCode).toBe(201)
    const dup = await app.inject({ method: 'POST', url: '/api/account/username', headers: auth(token), payload: { username: 'taken1' } })
    expect(dup.statusCode).toBe(409)
  })
})

describe('Apple ID 绑定/解绑（现存账号）', () => {
  it('绑定顺带绑 Apple 邮箱；他人占用 409；解绑需保留其它登录方式', async () => {
    const app = buildApp(new MemoryStore(), { appleVerifier: fakeApple, codeSend: noThrottle() })
    const a = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'alink', password: 'secret123' } })
    const ta = (a.json() as any).token

    const link = await app.inject({ method: 'POST', url: '/api/account/apple', headers: auth(ta), payload: { identityToken: 'good:SUBA:a@icloud.com' } })
    expect(link.statusCode).toBe(200)
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(ta) })
    expect((me.json() as any).user.appleLinked).toBe(true)
    expect((me.json() as any).user.email).toBe('a@icloud.com')
    expect((me.json() as any).user.emailVerified).toBe(true)

    // 账号 B 想绑同一 appleSub → 409
    const b = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'blink', password: 'secret123' } })
    const tb = (b.json() as any).token
    const conflict = await app.inject({ method: 'POST', url: '/api/account/apple', headers: auth(tb), payload: { identityToken: 'good:SUBA' } })
    expect(conflict.statusCode).toBe(409)

    // A 有已验证邮箱 → 可解绑
    const unlink = await app.inject({ method: 'DELETE', url: '/api/account/apple', headers: auth(ta) })
    expect(unlink.statusCode).toBe(200)
    const me2 = await app.inject({ method: 'GET', url: '/api/me', headers: auth(ta) })
    expect((me2.json() as any).user.appleLinked).toBe(false)
  })

  it('Apple-only 账号（无邮箱/手机/passkey）不能解绑，防锁死', async () => {
    const app = buildApp(new MemoryStore(), { appleVerifier: fakeApple, codeSend: noThrottle() })
    const c = await app.inject({ method: 'POST', url: '/api/auth/apple', payload: { identityToken: 'good:SUBC' } })
    expect(c.statusCode).toBe(201)
    const tc = (c.json() as any).token
    const cantUnlink = await app.inject({ method: 'DELETE', url: '/api/account/apple', headers: auth(tc) })
    expect(cantUnlink.statusCode).toBe(400)
  })
})

describe('新账号 created 标记 + 认证后统一选角色', () => {
  it('注册/Apple 建号/邮箱码建号返回 created=true；再登录不带 created', async () => {
    const mailer = new CaptureMailer()
    const app = buildApp(new MemoryStore(), { mailer, appleVerifier: fakeApple })

    const reg = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { username: 'crflag1', password: 'secret123' } })
    expect((reg.json() as any).created).toBe(true)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login',
      payload: { username: 'crflag1', password: 'secret123' } })
    expect((login.json() as any).created).toBeUndefined()

    const apple1 = await app.inject({ method: 'POST', url: '/api/auth/apple', payload: { identityToken: 'good:CRSUB' } })
    expect((apple1.json() as any).created).toBe(true)
    const apple2 = await app.inject({ method: 'POST', url: '/api/auth/apple', payload: { identityToken: 'good:CRSUB' } })
    expect((apple2.json() as any).created).toBeUndefined()

    await app.inject({ method: 'POST', url: '/api/auth/email/request-code', payload: { email: 'cr@example.com' } })
    const v = await app.inject({ method: 'POST', url: '/api/auth/email/verify-code',
      payload: { email: 'cr@example.com', code: mailer.code() } })
    expect((v.json() as any).created).toBe(true)
  })

  it('POST /api/account/role：自助角色可切换；非法值 400；admin 不可自助变更', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { username: 'roleme1', password: 'secret123' } }) // 默认 blind
    const t = (reg.json() as any).token as string

    const toHelper = await app.inject({ method: 'POST', url: '/api/account/role', headers: auth(t), payload: { role: 'helper' } })
    expect(toHelper.statusCode).toBe(200)
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(t) })
    expect((me.json() as any).user.role).toBe('helper')

    const bad = await app.inject({ method: 'POST', url: '/api/account/role', headers: auth(t), payload: { role: 'admin' } })
    expect(bad.statusCode).toBe(400) // enum 拒绝

    // admin 账号不可经此自助变更（防误锁后台）。
    const uid = (me.json() as any).user.id as string
    store.updateUser(uid, { role: 'admin' })
    const locked = await app.inject({ method: 'POST', url: '/api/account/role', headers: auth(t), payload: { role: 'blind' } })
    expect(locked.statusCode).toBe(403)
  })
})

describe('Apple 关联域文件（passkey 前提）', () => {
  it('GET /.well-known/apple-app-site-association 返回 webcredentials JSON', async () => {
    const app = buildApp(new MemoryStore(), { codeSend: noThrottle() })
    const res = await app.inject({ method: 'GET', url: '/.well-known/apple-app-site-association' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    const apps = (res.json() as any).webcredentials.apps as string[]
    expect(apps[0]).toMatch(/\.com\.beeurei\.BeeUrEi$/)
  })
})

describe('邮件服务故障的诚实处理', () => {
  class FailMailer implements Mailer {
    async send(): Promise<void> { throw new Error('535 authentication failed') }
  }

  it('绑定邮箱发码失败 → 503 mail_unavailable 且邮箱变更回滚', async () => {
    const app = buildApp(new MemoryStore(), { mailer: new FailMailer() })
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { username: 'mailfail1', password: 'secret123' } })
    const t = (reg.json() as any).token as string

    const res = await app.inject({ method: 'POST', url: '/api/account/email', headers: auth(t),
      payload: { email: 'rollback@example.com' } })
    expect(res.statusCode).toBe(503)
    expect((res.json() as any).error).toBe('mail_unavailable')
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(t) })
    expect((me.json() as any).user.email ?? null).toBeNull() // 失败不留下"已改未验证"的半截状态
  })

  it('邮箱码登录发码失败 → 503 mail_unavailable（不假装已发送）', async () => {
    const app = buildApp(new MemoryStore(), { mailer: new FailMailer() })
    const res = await app.inject({ method: 'POST', url: '/api/auth/email/request-code',
      payload: { email: 'whoever@example.com' } })
    expect(res.statusCode).toBe(503)
    expect((res.json() as any).error).toBe('mail_unavailable')
  })
})
