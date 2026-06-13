import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import type { AppleTokenVerifier } from '../src/auth/apple'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })

// 假验证器：token 形如 "sub|email|verified"。
const fakeVerifier: AppleTokenVerifier = async (token) => {
  const [sub, email, verified] = token.split('|')
  if (!sub) return null
  return { sub, email: email || undefined, emailVerified: verified === '1' }
}

describe('Apple 登录并号（按已验证邮箱）', () => {
  it('已有邮箱账号 + 同邮箱 Apple 登录 → 并入该账号，不另建新号（用户反馈 #1）', async () => {
    const store = new MemoryStore()
    const app = buildApp(store, { appleVerifier: fakeVerifier })
    // 先用邮箱+密码注册一个账号。
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { password: 'secret123', email: 'mei@example.com' } })
    expect(reg.statusCode).toBe(201)
    const existingId = (reg.json() as any).user.id

    // 用相同（已验证）邮箱的 Apple 登录。
    const apple = await app.inject({ method: 'POST', url: '/api/auth/apple',
      payload: { identityToken: 'apple-sub-1|mei@example.com|1' } })
    expect(apple.statusCode).toBe(200) // 200=登录已有账号（非 201 新建）
    const body = apple.json() as any
    expect(body.created).toBeUndefined()
    expect(body.user.id).toBe(existingId) // 同一账号
    await app.close()
  })

  it('再次用同一 Apple sub 登录 → 仍命中同一账号（按 appleSub）', async () => {
    const store = new MemoryStore()
    const app = buildApp(store, { appleVerifier: fakeVerifier })
    await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { password: 'secret123', email: 'lin@example.com' } })
    const first = await app.inject({ method: 'POST', url: '/api/auth/apple',
      payload: { identityToken: 'sub-x|lin@example.com|1' } })
    const id1 = (first.json() as any).user.id
    const again = await app.inject({ method: 'POST', url: '/api/auth/apple',
      payload: { identityToken: 'sub-x|lin@example.com|1' } })
    expect(again.statusCode).toBe(200)
    expect((again.json() as any).user.id).toBe(id1)
    await app.close()
  })

  it('邮箱未验证 → 不自动并号（安全：建新号）', async () => {
    const store = new MemoryStore()
    const app = buildApp(store, { appleVerifier: fakeVerifier })
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { password: 'secret123', email: 'safe@example.com' } })
    const existingId = (reg.json() as any).user.id
    const apple = await app.inject({ method: 'POST', url: '/api/auth/apple',
      payload: { identityToken: 'sub-unverified|safe@example.com|0' } }) // verified=0
    expect(apple.statusCode).toBe(201) // 新建
    expect((apple.json() as any).user.id).not.toBe(existingId)
    await app.close()
  })
})

describe('按精确标识查人 /api/users/lookup', () => {
  it('按用户名 / 邮箱 / 手机号精确查到对方公开资料', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    // 目标用户：用户名 alice + 邮箱 + 手机号。
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { username: 'alice', password: 'secret123', email: 'alice@example.com', phone: '+8613800138000' } })
    expect(reg.statusCode).toBe(201)
    // 查询者。
    const me = await app.inject({ method: 'POST', url: '/api/auth/register',
      payload: { username: 'bob', password: 'secret123' } })
    const t = (me.json() as any).token
    // 用户名 / 邮箱 / 完整 E.164 手机号都能精确命中（裸号无区号不匹配——符合预期，故不测）。
    for (const q of ['alice', 'alice@example.com', '+8613800138000']) {
      const res = await app.inject({ method: 'GET', url: `/api/users/lookup?q=${encodeURIComponent(q)}`, headers: auth(t) })
      expect(res.statusCode, q).toBe(200)
      expect((res.json() as any).user.username).toBe('alice')
    }
    // 查无：404。
    const none = await app.inject({ method: 'GET', url: '/api/users/lookup?q=nobody@nowhere.com', headers: auth(t) })
    expect(none.statusCode).toBe(404)
    await app.close()
  })
})
