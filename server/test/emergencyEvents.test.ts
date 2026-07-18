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
    return { a, store, owner, helper, auth, adminTok }
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

  it('概览 emergencyTotals 反映紧急响应履约：alerts/acked/unreachable 累计（自托管者无 Prometheus 亦可见）', async () => {
    const { a, auth, adminTok, owner, helper } = await seed()
    const overview = async () => (await a.inject({ method: 'GET', url: '/api/admin/overview', headers: { authorization: `Bearer ${adminTok}` } })).json()
    expect((await overview()).emergencyTotals).toMatchObject({ alerts: 0, acked: 0, unreachable: 0 }) // 初始
    // 盲人发一次告警；亲友"知道了"响应。
    await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth, payload: { kind: 'manual' } })
    await a.inject({ method: 'POST', url: '/api/emergency/ack', headers: { authorization: `Bearer ${helper.token}` }, payload: { fromId: owner.user.id } })
    // 概览如实反映：1 次告警、1 次响应（响应率=有人看见/管的可靠性履历）。
    expect((await overview()).emergencyTotals).toMatchObject({ alerts: 1, acked: 1 })
    await a.close()
  })

  it('高峰期列表：进行中事件被 120 条新事件挤出"最近 100"仍在列表（列表 = 近 100 ∪ 全部进行中，红标不丢）', async () => {
    const { a, store, adminTok, owner } = await seed()
    const now = Date.now()
    // 一条进行中（未解除、未触达任何人=最该人工介入的红标）+ 120 条已解除的新事件把它挤出"最近 100"。
    store.createEmergencyEvent({ id: 'ongoing', userId: owner.user.id, kind: 'fall', notified: 0, contacts: 1, at: now - 3600_000 })
    for (let i = 0; i < 120; i++) {
      store.createEmergencyEvent({ id: `fl${i}`, userId: owner.user.id, kind: 'manual', notified: 1, contacts: 1, at: now - 60_000 + i, resolvedAt: now })
    }
    expect(store.recentEmergencyEvents(100).some((e) => e.id === 'ongoing')).toBe(false) // 确已被窗口挤出（回归前置）
    const res = await a.inject({ method: 'GET', url: '/api/admin/emergencies', headers: { authorization: `Bearer ${adminTok}` } })
    const ids = res.json().events.map((e: { id: string }) => e.id)
    expect(ids).toContain('ongoing')            // 概览计数里有的进行中事件，列表里必须找得到（不许"计数有、列表无"）
    expect(res.json().events.length).toBe(101)  // 最近 100 ∪ 1 条进行中；已解除陈旧事件不因并集无限膨胀
    // 时间倒序不变（并入者按 at 落位到列表尾部附近，仍带显示名）。
    expect(res.json().events[res.json().events.length - 1]).toMatchObject({ id: 'ongoing', userName: 'evfaller' })
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
    await a.inject({ method: 'DELETE', url: '/api/account', headers: auth, payload: { password: 'secret123' } }) // 删号须重输密码
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

  it('resolveOpenEmergencyEvents（双存储同口径）：报平安一次解除本人**全部**未解除事件，返回条数；他人不受影响', () => {
    for (const store of [new MemoryStore(), new SqliteStore(':memory:')]) {
      store.createEmergencyEvent({ id: 'e1', userId: 'u', kind: 'fall', notified: 1, contacts: 1, at: 1000 })
      store.createEmergencyEvent({ id: 'e2', userId: 'u', kind: 'manual', notified: 0, contacts: 1, at: 2000 }) // 同时两条未决（自动摔倒+手动SOS）
      store.createEmergencyEvent({ id: 'x', userId: 'other', kind: 'fall', notified: 0, contacts: 0, at: 3000 })
      const byId = (id: string, uid = 'u') => store.emergencyEventsForUser(uid).find((e) => e.id === id)!
      // 报一次平安 → e1、e2 都解除（否则遗留的会被升级重呼在本人已安全后二次误报）。
      expect(store.resolveOpenEmergencyEvents('u', 5000)).toBe(2)
      expect(byId('e1').resolvedAt).toBe(5000)
      expect(byId('e2').resolvedAt).toBe(5000)
      // 已全部解除 → 再报平安解除 0 条（不误标）。
      expect(store.resolveOpenEmergencyEvents('u', 6000)).toBe(0)
      // 关键回归：解除后升级候选里不再有 u 的事件（遗留旧事件不会被 escalate 二次误报）。
      expect(store.unacknowledgedEmergencyEvents(4000, 6000).filter((e) => e.userId === 'u')).toHaveLength(0)
      // 别人的事件不受影响。
      expect(byId('x', 'other').resolvedAt).toBeUndefined()
    }
  })
})
