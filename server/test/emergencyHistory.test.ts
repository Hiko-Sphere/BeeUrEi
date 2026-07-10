import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 本人紧急事件历史 GET /api/emergency/history：过往 SOS/摔倒回看，倒序，仅本人，仅展示字段 + 响应结果布尔。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

describe('紧急事件历史 /api/emergency/history', () => {
  it('倒序返回本人事件；acked/escalated/resolved 归为布尔；不含他人', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const me = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'ehOwner', password: 'secret123', role: 'blind' } })).json()
    const other = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'ehOther', password: 'secret123', role: 'blind' } })).json()
    store.createEmergencyEvent({ id: 'e1', userId: me.user.id, kind: 'fall', locSource: 'live', lat: 31.2, lon: 121.4, notified: 2, contacts: 3, at: 1000, resolvedAt: 1500 })
    store.createEmergencyEvent({ id: 'e2', userId: me.user.id, kind: 'manual', locSource: 'none', notified: 0, contacts: 1, at: 3000, escalatedAt: 3500 })
    store.createEmergencyEvent({ id: 'x1', userId: other.user.id, kind: 'crash', locSource: 'none', notified: 1, contacts: 1, at: 2000 })

    const r = await app.inject({ method: 'GET', url: '/api/emergency/history', headers: auth(me.token) })
    expect(r.statusCode).toBe(200)
    const h = r.json().history
    expect(h.map((x: { id: string }) => x.id)).toEqual(['e2', 'e1']) // at 倒序，且不含他人 x1
    expect(h[1]).toMatchObject({ kind: 'fall', notified: 2, contacts: 3, resolved: true, acked: false, escalated: false, lat: 31.2, lon: 121.4 })
    expect(h[0]).toMatchObject({ kind: 'manual', resolved: false, escalated: true, lat: null, lon: null }) // 无坐标→null
    await app.close()
  })

  it('无历史 → 空数组；未登录 → 401', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const me = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'ehEmpty', password: 'secret123', role: 'blind' } })).json()
    expect((await app.inject({ method: 'GET', url: '/api/emergency/history', headers: auth(me.token) })).json()).toEqual({ history: [] })
    expect((await app.inject({ method: 'GET', url: '/api/emergency/history' })).statusCode).toBe(401)
    await app.close()
  })
})
