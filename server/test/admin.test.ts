import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type User } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'

function withAdmin() {
  const store = new MemoryStore()
  const admin: User = {
    id: 'admin1',
    username: 'root',
    passwordHash: hashPassword('rootpass1'),
    displayName: 'root',
    role: 'admin',
    status: 'active',
    createdAt: Date.now(),
  }
  store.createUser(admin)
  return { store, app: buildApp(store) }
}

async function login(app: ReturnType<typeof buildApp>, username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } })
  return res.json().token as string
}

describe('admin + reports', () => {
  it('non-admin is forbidden from admin endpoints', async () => {
    const { app } = withAdmin()
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'alice', password: 'secret123' } })
    const token = reg.json().token
    const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('admin can list and ban users; banned user cannot log in', async () => {
    const { app } = withAdmin()
    const adminToken = await login(app, 'root', 'rootpass1')
    const adminAuth = { authorization: `Bearer ${adminToken}` }

    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bob', password: 'secret123' } })
    const bobId = reg.json().user.id

    const list = await app.inject({ method: 'GET', url: '/api/admin/users', headers: adminAuth })
    expect(list.statusCode).toBe(200)
    expect(list.json().users.length).toBe(2) // root + bob

    const ban = await app.inject({ method: 'POST', url: `/api/admin/users/${bobId}/status`, headers: adminAuth, payload: { status: 'disabled' } })
    expect(ban.statusCode).toBe(200)
    expect(ban.json().user.status).toBe('disabled')

    const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'bob', password: 'secret123' } })
    expect(blocked.statusCode).toBe(403)
    await app.close()
  })

  it('user submits a report; admin lists and resolves it', async () => {
    const { app } = withAdmin()
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'carol', password: 'secret123' } })
    const token = reg.json().token

    const create = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: { authorization: `Bearer ${token}` },
      payload: { targetUserId: 'someone', reason: '不当行为' },
    })
    expect(create.statusCode).toBe(201)
    const reportId = create.json().report.id

    const adminToken = await login(app, 'root', 'rootpass1')
    const adminAuth = { authorization: `Bearer ${adminToken}` }

    const list = await app.inject({ method: 'GET', url: '/api/admin/reports', headers: adminAuth })
    expect(list.json().reports.length).toBe(1)
    expect(list.json().reports[0].reporterName).toBe('carol') // 解析举报人显示名

    const resolve = await app.inject({ method: 'POST', url: `/api/admin/reports/${reportId}/resolve`, headers: adminAuth })
    expect(resolve.json().report.status).toBe('resolved')
    await app.close()
  })
})
