import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type User } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'

function user(over: Partial<User>): User {
  return {
    id: 'u', username: 'u', passwordHash: hashPassword('pw123456'),
    displayName: 'd', role: 'blind', status: 'active', createdAt: Date.now(), ...over,
  }
}

function app() {
  const s = new MemoryStore()
  s.createUser(user({ id: 'a', username: 'adminx', role: 'admin' }))
  s.createUser(user({ id: 'h', username: 'helperx', role: 'helper' }))
  s.createUser(user({ id: 'd', username: 'devx', role: 'developer' }))
  return buildApp(s)
}

async function login(a: ReturnType<typeof buildApp>, username: string) {
  const r = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'pw123456' } })
  return r.json().token as string
}

const ADMIN_URL = '/api/admin/users' // requireAuth(['admin']) 守护

describe('RBAC 访问控制门 (requireAuth)', () => {
  it('无 Authorization → 401', async () => {
    const a = app()
    expect((await a.inject({ method: 'GET', url: ADMIN_URL })).statusCode).toBe(401)
    await a.close()
  })

  it('Authorization 非 Bearer 格式 → 401', async () => {
    const a = app()
    const r = await a.inject({ method: 'GET', url: ADMIN_URL, headers: { authorization: 'Token abc' } })
    expect(r.statusCode).toBe(401)
    await a.close()
  })

  it('无效/伪造 token → 401', async () => {
    const a = app()
    const r = await a.inject({ method: 'GET', url: ADMIN_URL, headers: { authorization: 'Bearer not.a.real.jwt' } })
    expect(r.statusCode).toBe(401)
    await a.close()
  })

  it('helper 越权访问 admin → 403', async () => {
    const a = app()
    const t = await login(a, 'helperx')
    const r = await a.inject({ method: 'GET', url: ADMIN_URL, headers: { authorization: `Bearer ${t}` } })
    expect(r.statusCode).toBe(403)
    await a.close()
  })

  it('developer 不是 admin → 403（角色隔离）', async () => {
    const a = app()
    const t = await login(a, 'devx')
    const r = await a.inject({ method: 'GET', url: ADMIN_URL, headers: { authorization: `Bearer ${t}` } })
    expect(r.statusCode).toBe(403)
    await a.close()
  })

  it('admin 正确角色 → 200', async () => {
    const a = app()
    const t = await login(a, 'adminx')
    const r = await a.inject({ method: 'GET', url: ADMIN_URL, headers: { authorization: `Bearer ${t}` } })
    expect(r.statusCode).toBe(200)
    await a.close()
  })
})

describe('access token 实时失效 (封禁/改密)', () => {
  const SELF_URL = '/api/family/links'

  it('封禁后，封禁前签发的 access token 立即失效（不等 1h TTL）', async () => {
    const s = new MemoryStore()
    s.createUser(user({ id: 'h', username: 'banme', role: 'helper' }))
    const a = buildApp(s)
    const t = await login(a, 'banme')
    expect((await a.inject({ method: 'GET', url: SELF_URL, headers: { authorization: `Bearer ${t}` } })).statusCode).toBe(200)
    s.updateUser('h', { status: 'disabled' }) // 管理员封禁
    expect((await a.inject({ method: 'GET', url: SELF_URL, headers: { authorization: `Bearer ${t}` } })).statusCode).toBe(401)
    await a.close()
  })

  it('改密后(tokenVersion 递增)，旧 access token 立即失效', async () => {
    const s = new MemoryStore()
    s.createUser(user({ id: 'u', username: 'changer', role: 'blind' }))
    const a = buildApp(s)
    const t = await login(a, 'changer')
    expect((await a.inject({ method: 'GET', url: SELF_URL, headers: { authorization: `Bearer ${t}` } })).statusCode).toBe(200)
    const chg = await a.inject({ method: 'POST', url: '/api/account/password',
      headers: { authorization: `Bearer ${t}` }, payload: { oldPassword: 'pw123456', newPassword: 'newpw123456' } })
    expect(chg.statusCode).toBe(200)
    // 旧 token 的 tv 与递增后的库值不符 → 立即失效
    expect((await a.inject({ method: 'GET', url: SELF_URL, headers: { authorization: `Bearer ${t}` } })).statusCode).toBe(401)
    await a.close()
  })
})
