import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type EmergencyEvent } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { hashPassword } from '../src/auth/passwords'

// 紧急事件日志（治理/值守）：告警落账 → admin 可见（含诚实位置来源）；删号级联；留存清扫；幂等不重复落账。
describe('紧急事件日志', () => {
  async function seed() {
    const store = new MemoryStore()
    store.createUser({ id: 'admin1', username: 'root', passwordHash: hashPassword('secret123'),
      displayName: 'root', role: 'admin', status: 'active', createdAt: 1000 })
    const a = buildApp(store)
    const reg = async (u: string, role: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const owner = await reg('evfaller', 'blind')
    const helper = await reg('evhelper', 'helper')
    const auth = { authorization: `Bearer ${owner.token}` }
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'evhelper', relation: '家人', isEmergency: true } })
    await a.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`, headers: { authorization: `Bearer ${helper.token}` } })
    const adminTok = (await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'secret123' } })).json().token
    return { a, store, owner, auth, adminTok }
  }

  it('告警落账：kind/坐标/位置来源/通知数如实记录；admin 端点带显示名；非 admin 403', async () => {
    const { a, auth, adminTok, owner } = await seed()
    await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth,
      payload: { kind: 'fall', lat: 31.2, lon: 121.5 } })
    const res = await a.inject({ method: 'GET', url: '/api/admin/emergencies', headers: { authorization: `Bearer ${adminTok}` } })
    expect(res.statusCode).toBe(200)
    const [ev] = res.json().events
    expect(ev).toMatchObject({ kind: 'fall', lat: 31.2, lon: 121.5, locSource: 'live', contacts: 1, userName: 'evfaller' })
    // 非 admin 拒绝（坐标是敏感 PII）。
    const forbidden = await a.inject({ method: 'GET', url: '/api/admin/emergencies', headers: auth })
    expect(forbidden.statusCode).toBe(403)
    // 无坐标未共享 → locSource=none 也如实落账。
    await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth, payload: { kind: 'manual' } })
    const res2 = await a.inject({ method: 'GET', url: '/api/admin/emergencies', headers: { authorization: `Bearer ${adminTok}` } })
    expect(res2.json().events[0]).toMatchObject({ kind: 'manual', locSource: 'none', userName: 'evfaller' })
    expect(res2.json().events[0].lat).toBeFalsy()
    // 值守可观测：两次告警 → Prometheus 计数 emergency_alerts_total 2（设阈值可警报风暴/异常静默）。
    const metrics = await a.inject({ method: 'GET', url: '/metrics' })
    expect(metrics.payload).toContain('emergency_alerts_total 2')
    void owner
    await a.close()
  })

  it('alertId 重试幂等：同一事件只落一条账', async () => {
    const { a, auth, store } = await seed()
    const payload = { kind: 'fall', alertId: 'once-1' }
    await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth, payload })
    await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth, payload }) // 重试
    expect(store.recentEmergencyEvents().length).toBe(1)
    await a.close()
  })

  it('删号级联：用户删除后其紧急事件（含坐标 PII）随之抹除', async () => {
    const { a, auth, store } = await seed()
    await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth, payload: { kind: 'fall', lat: 1, lon: 2 } })
    expect(store.recentEmergencyEvents().length).toBe(1)
    await a.inject({ method: 'DELETE', url: '/api/account', headers: auth })
    expect(store.recentEmergencyEvents().length).toBe(0)
    await a.close()
  })

  it('留存清扫（双存储）：删旧留新+幂等', () => {
    const now = 1_700_000_000_000
    const DAY = 86_400_000
    const ev = (id: string, at: number): EmergencyEvent => ({ id, userId: 'u', kind: 'fall', notified: 1, contacts: 1, at })
    for (const store of [new MemoryStore(), new SqliteStore(':memory:')]) {
      store.createEmergencyEvent(ev('old', now - 181 * DAY))
      store.createEmergencyEvent(ev('fresh', now - 179 * DAY))
      expect(store.deleteEmergencyEventsOlderThan(now - 180 * DAY)).toBe(1)
      expect(store.recentEmergencyEvents().map((e) => e.id)).toEqual(['fresh'])
      expect(store.deleteEmergencyEventsOlderThan(now - 180 * DAY)).toBe(0)
    }
  })

  it('SqliteStore 字段完整往返（可选字段 null 与数值都不失真）', () => {
    const store = new SqliteStore(':memory:')
    store.createEmergencyEvent({ id: 'e1', userId: 'u', kind: 'crash', lat: 39.9, lon: 116.4,
      locSource: 'lastKnown', locAgeSec: 120, notified: 3, contacts: 5, at: 1000 })
    store.createEmergencyEvent({ id: 'e2', userId: 'u', kind: 'manual', notified: 0, contacts: 2, at: 2000 })
    const [e2, e1] = store.recentEmergencyEvents()
    expect(e1).toEqual({ id: 'e1', userId: 'u', kind: 'crash', lat: 39.9, lon: 116.4,
      locSource: 'lastKnown', locAgeSec: 120, notified: 3, contacts: 5, at: 1000 })
    expect(e2.lat).toBeUndefined()
    expect(e2.locSource).toBe(undefined)
  })

  it('resolveLatestEmergencyEvent（双存储同口径）：解除最近一条未解除的，逐条推进，都解除后 false', () => {
    for (const store of [new MemoryStore(), new SqliteStore(':memory:')]) {
      store.createEmergencyEvent({ id: 'e1', userId: 'u', kind: 'fall', notified: 1, contacts: 1, at: 1000 })
      store.createEmergencyEvent({ id: 'e2', userId: 'u', kind: 'manual', notified: 0, contacts: 1, at: 2000 })
      store.createEmergencyEvent({ id: 'x', userId: 'other', kind: 'fall', notified: 0, contacts: 0, at: 3000 })
      // 报平安解除 u 的最近一条(e2, at=2000)
      expect(store.resolveLatestEmergencyEvent('u', 5000)).toBe(true)
      const byId = (id: string) => store.emergencyEventsForUser('u').find((e) => e.id === id)!
      expect(byId('e2').resolvedAt).toBe(5000)
      expect(byId('e1').resolvedAt).toBeUndefined()  // 更早的那条不动
      // 再解除 → 现在最近未解除的是 e1
      expect(store.resolveLatestEmergencyEvent('u', 6000)).toBe(true)
      expect(byId('e1').resolvedAt).toBe(6000)
      // 都已解除 → false（不误标）
      expect(store.resolveLatestEmergencyEvent('u', 7000)).toBe(false)
      // 别人的事件不受影响
      expect(store.emergencyEventsForUser('other')[0].resolvedAt).toBeUndefined()
    }
  })
})
