import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SignalingHub } from '../src/signaling/hub'
import { hashPassword } from '../src/auth/passwords'

function withAdmin() {
  const store = new MemoryStore()
  store.createUser({ id: 'admin1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() })
  return { store, app: buildApp(store) }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
async function adminAuth(app: ReturnType<typeof buildApp>) {
  return auth((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token)
}

describe('SignalingHub.activeCalls 聚合', () => {
  it('按 callId 聚合参与者、取最早加入为开始时间、标记是否有管理员、按开始倒序', () => {
    const hub = new SignalingHub()
    hub.join({ clientId: 'a', userId: 'blindU', role: 'blind', callId: 'c1', joinedAt: 1000 })
    hub.join({ clientId: 'b', userId: 'helperU', role: 'helper', callId: 'c1', joinedAt: 1500 })
    hub.join({ clientId: 'c', userId: 'adminU', role: 'admin', callId: 'c1', joinedAt: 2000 })
    hub.join({ clientId: 'd', userId: 'x', role: 'blind', callId: 'c2', joinedAt: 5000 })
    const calls = hub.activeCalls()
    expect(calls.length).toBe(2)
    expect(calls[0].callId).toBe('c2') // c2 开始更晚 → 倒序在前
    const c1 = calls.find((c) => c.callId === 'c1')!
    expect(c1.startedAt).toBe(1000)
    expect(c1.members.length).toBe(3)
    expect(c1.hasAdminObserver).toBe(true)
    const c2 = calls.find((c) => c.callId === 'c2')!
    expect(c2.hasAdminObserver).toBe(false)
    // 离开后聚合更新
    hub.leave('d')
    expect(hub.activeCalls().length).toBe(1)
  })
})

describe('GET /api/admin/calls/active', () => {
  it('仅管理员可访问；无进行中通话返回空', async () => {
    const { app } = withAdmin()
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bob', password: 'secret123' } })
    const forbidden = await app.inject({ method: 'GET', url: '/api/admin/calls/active', headers: auth(reg.json().token) })
    expect(forbidden.statusCode).toBe(403)
    const ok = await app.inject({ method: 'GET', url: '/api/admin/calls/active', headers: await adminAuth(app) })
    expect(ok.statusCode).toBe(200)
    expect(Array.isArray(ok.json().calls)).toBe(true)
    expect(ok.json().calls.length).toBe(0) // 测试环境无 ws 连接
    await app.close()
  })
})

describe('POST /api/admin/calls/:callId/end', () => {
  it('无进行中通话 → 404 not_active；非管理员 403', async () => {
    const { app } = withAdmin()
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'carol', password: 'secret123' } })
    const forbidden = await app.inject({ method: 'POST', url: '/api/admin/calls/c1/end', headers: auth(reg.json().token) })
    expect(forbidden.statusCode).toBe(403)
    const none = await app.inject({ method: 'POST', url: '/api/admin/calls/c1/end', headers: await adminAuth(app) })
    expect(none.statusCode).toBe(404)
    expect(none.json().error).toBe('not_active')
    await app.close()
  })
})
