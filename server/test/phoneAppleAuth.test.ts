import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { normalizePhone, type AppleTokenVerifier } from '../src/auth/apple'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })

describe('手机号归一化', () => {
  it('去空格横线括号点、保留前导加号、长度校验', () => {
    expect(normalizePhone('138 0013 8000')).toBe('13800138000')
    expect(normalizePhone('+86-138(0013)8000')).toBe('+8613800138000')
    expect(normalizePhone('305.555.0199')).toBe('3055550199')          // 点分隔（美/欧常见）也归一
    expect(normalizePhone('+1 (305) 555.0199')).toBe('+13055550199')   // 括号+点+空格混排
    expect(normalizePhone('12345')).toBeNull()        // 太短
    expect(normalizePhone('abc12345678')).toBeNull()  // 非数字
    expect(normalizePhone('1234567890123456')).toBeNull() // 太长
  })
})

describe('手机号 + 密码登录', () => {
  it('注册带手机号 → 用户名和手机号都能登录（手机号任意书写格式）', async () => {
    const app = buildApp(new MemoryStore())
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { username: 'lihua', password: 'secret123', phone: '138 0013 8000' } })
    expect(reg.statusCode).toBe(201)

    const byName = await app.inject({ method: 'POST', url: '/api/auth/login',
      payload: { username: 'lihua', password: 'secret123' } })
    expect(byName.statusCode).toBe(200)

    const byPhone = await app.inject({ method: 'POST', url: '/api/auth/login',
      payload: { username: '138-0013-8000', password: 'secret123' } }) // 书写格式不同也可
    expect(byPhone.statusCode).toBe(200)
    expect((byPhone.json() as any).user.username).toBe('lihua')
  })

  it('手机号被占用拒绝注册（409）；非法手机号 400', async () => {
    const app = buildApp(new MemoryStore())
    await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { username: 'a1a1', password: 'secret123', phone: '13800138000' } })
    const dup = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { username: 'b2b2', password: 'secret123', phone: '138 0013 8000' } })
    expect(dup.statusCode).toBe(409)
    expect((dup.json() as any).error).toBe('phone_taken')
    const bad = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { username: 'c3c3', password: 'secret123', phone: 'abc-def' } })
    expect(bad.statusCode).toBe(400)
  })

  it('账号页绑定手机号：本人可绑、他人号码 409、绑后可用手机号登录', async () => {
    const app = buildApp(new MemoryStore())
    const r1 = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { username: 'owner1', password: 'secret123', phone: '13900139000' } })
    const r2 = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { username: 'later2', password: 'secret123' } })
    const t2 = (r2.json() as any).token as string

    const taken = await app.inject({ method: 'POST', url: '/api/account/phone',
      headers: auth(t2), payload: { phone: '139 0013 9000' } })
    expect(taken.statusCode).toBe(409) // 不能占用他人手机号

    const ok = await app.inject({ method: 'POST', url: '/api/account/phone',
      headers: auth(t2), payload: { phone: '+86 137 0013 7000' } })
    expect(ok.statusCode).toBe(200)

    const login = await app.inject({ method: 'POST', url: '/api/auth/login',
      payload: { username: '+8613700137000', password: 'secret123' } })
    expect(login.statusCode).toBe(200)
    expect((login.json() as any).user.username).toBe('later2')
    expect(r1.statusCode).toBe(201)
  })
})

describe('免用户名注册（手机号/邮箱即账号）', () => {
  it('只给手机号注册 → 自动生成随机用户名（不泄露手机号），手机号可登录', async () => {
    const app = buildApp(new MemoryStore())
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { password: 'secret123', phone: '136 0013 6000' } })
    expect(reg.statusCode).toBe(201)
    const u = (reg.json() as any).user
    expect(u.username).toMatch(/^user_/)            // 自动生成
    expect(u.username).not.toContain('13600136000') // 不从手机号派生（username 对外可见）

    const login = await app.inject({ method: 'POST', url: '/api/auth/login',
      payload: { username: '+13600136000'.replace('+', ''), password: 'secret123' } })
    expect(login.statusCode).toBe(200)
    expect((login.json() as any).user.id).toBe(u.id)
  })

  it('只给邮箱注册 → 邮箱可登录（大小写不敏感）；重复邮箱 409', async () => {
    const app = buildApp(new MemoryStore())
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { password: 'secret123', email: 'Mei@Example.com' } })
    expect(reg.statusCode).toBe(201)
    const u = (reg.json() as any).user
    expect(u.username).toMatch(/^user_/)

    const login = await app.inject({ method: 'POST', url: '/api/auth/login',
      payload: { username: 'mei@example.COM', password: 'secret123' } })
    expect(login.statusCode).toBe(200)
    expect((login.json() as any).user.id).toBe(u.id)

    const dup = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { password: 'secret123', email: 'MEI@example.com' } })
    expect(dup.statusCode).toBe(409)
    expect((dup.json() as any).error).toBe('email_taken')
  })

  it('用户名/手机号/邮箱一个都不给 → 400；不存在的邮箱登录 401', async () => {
    const app = buildApp(new MemoryStore())
    const none = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { password: 'secret123' } })
    expect(none.statusCode).toBe(400)

    const ghost = await app.inject({ method: 'POST', url: '/api/auth/login',
      payload: { username: 'nobody@example.com', password: 'secret123' } })
    expect(ghost.statusCode).toBe(401)
  })

  it('账号页绑定邮箱后也能用邮箱登录；他人邮箱 409', async () => {
    const app = buildApp(new MemoryStore())
    const r1 = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { username: 'mailme', password: 'secret123' } })
    const t1 = (r1.json() as any).token as string
    await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { password: 'secret123', email: 'used@example.com' } })

    const taken = await app.inject({ method: 'POST', url: '/api/account/email',
      headers: auth(t1), payload: { email: 'USED@example.com' } })
    expect(taken.statusCode).toBe(409) // 不能占用他人邮箱

    const ok = await app.inject({ method: 'POST', url: '/api/account/email',
      headers: auth(t1), payload: { email: 'mine@example.com' } })
    expect(ok.statusCode).toBe(200)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login',
      payload: { username: 'mine@example.com', password: 'secret123' } })
    expect(login.statusCode).toBe(200)
    expect((login.json() as any).user.username).toBe('mailme')
  })
})

describe('Sign in with Apple', () => {
  const fakeVerifier: AppleTokenVerifier = async (token) =>
    token.startsWith('good:') ? { sub: token.slice(5), email: 'a@icloud.com' } : null

  it('未配置验证器 → 503 明确告知（不假装成功）', async () => {
    const app = buildApp(new MemoryStore()) // 不传 appleVerifier 且无 APPLE_BUNDLE_ID
    const res = await app.inject({ method: 'POST', url: '/api/auth/apple',
      payload: { identityToken: 'whatever' } })
    expect(res.statusCode).toBe(503)
  })

  it('新 sub 自动建号(201)，同 sub 再登录返回同一账号(200)', async () => {
    const app = buildApp(new MemoryStore(), { appleVerifier: fakeVerifier })
    const first = await app.inject({ method: 'POST', url: '/api/auth/apple',
      payload: { identityToken: 'good:SUB123', displayName: '小苹果' } })
    expect(first.statusCode).toBe(201)
    const u1 = (first.json() as any).user
    expect(u1.displayName).toBe('小苹果')

    const again = await app.inject({ method: 'POST', url: '/api/auth/apple',
      payload: { identityToken: 'good:SUB123' } })
    expect(again.statusCode).toBe(200)
    expect((again.json() as any).user.id).toBe(u1.id) // 同一账号，不重复建号
  })

  it('无效 token 401；被封禁账号 403', async () => {
    const store = new MemoryStore()
    const app = buildApp(store, { appleVerifier: fakeVerifier })
    const bad = await app.inject({ method: 'POST', url: '/api/auth/apple',
      payload: { identityToken: 'forged' } })
    expect(bad.statusCode).toBe(401)

    const first = await app.inject({ method: 'POST', url: '/api/auth/apple',
      payload: { identityToken: 'good:BANNED' } })
    const uid = (first.json() as any).user.id as string
    store.updateUser(uid, { status: 'disabled' })
    const blocked = await app.inject({ method: 'POST', url: '/api/auth/apple',
      payload: { identityToken: 'good:BANNED' } })
    expect(blocked.statusCode).toBe(403)
  })
})
