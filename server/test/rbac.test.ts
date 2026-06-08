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
