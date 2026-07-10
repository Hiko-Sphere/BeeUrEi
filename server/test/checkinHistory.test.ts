import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 报到历史 GET /api/safety/checkin/history：本人回看近 30 条，含已告警(fired)的那几次，仅展示字段。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

describe('报到历史 /api/safety/checkin/history', () => {
  it('倒序返回本人报到；endedAt 归一为 完成/取消/告警 时刻；仅本人可见', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const me = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'chOwner', password: 'secret123', role: 'blind' } })).json()
    const other = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'chOther', password: 'secret123', role: 'blind' } })).json()
    // 直接造三条历史（完成/告警/进行中）+ 一条属于他人。
    store.createSafetyTimer({ id: 't1', ownerId: me.user.id, startedAt: 1000, dueAt: 2000, status: 'completed', completedAt: 1500, note: '步行回家' })
    store.createSafetyTimer({ id: 't2', ownerId: me.user.id, startedAt: 3000, dueAt: 4000, status: 'fired', firedAt: 4000, eventId: 'e1' })
    store.createSafetyTimer({ id: 't3', ownerId: me.user.id, startedAt: 5000, dueAt: 6000, status: 'active' })
    store.createSafetyTimer({ id: 'x1', ownerId: other.user.id, startedAt: 5500, dueAt: 6500, status: 'completed', completedAt: 6000 })

    const r = await app.inject({ method: 'GET', url: '/api/safety/checkin/history', headers: auth(me.token) })
    expect(r.statusCode).toBe(200)
    const h = r.json().history
    expect(h.map((x: { id: string }) => x.id)).toEqual(['t3', 't2', 't1']) // startedAt 倒序，且不含他人 x1
    expect(h[2]).toMatchObject({ status: 'completed', endedAt: 1500, note: '步行回家' }) // 完成→completedAt
    expect(h[1]).toMatchObject({ status: 'fired', endedAt: 4000 })                       // 告警→firedAt
    expect(h[0]).toMatchObject({ status: 'active', endedAt: null })                       // 进行中→null
    await app.close()
  })

  it('无历史 → 空数组，200', async () => {
    const app = buildApp(new MemoryStore())
    const me = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'chEmpty', password: 'secret123', role: 'blind' } })).json()
    expect((await app.inject({ method: 'GET', url: '/api/safety/checkin/history', headers: auth(me.token) })).json()).toEqual({ history: [] })
    await app.close()
  })

  it('未登录 → 401', async () => {
    const app = buildApp(new MemoryStore())
    expect((await app.inject({ method: 'GET', url: '/api/safety/checkin/history' })).statusCode).toBe(401)
    await app.close()
  })
})
