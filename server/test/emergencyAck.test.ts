import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 紧急告警"知道了"回执：亲友确认已看到 → 发起人收到"X 已看到你的求助"通知（遇险者最需要的反馈）。
// 授权：仅**已接受**亲友可回执；不能确认自己的；同一亲友对同一事件多次点只回告一次（不轰炸遇险者）。
describe('紧急告警回执 /api/emergency/ack', () => {
  async function seed() {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const owner = await reg('acksender', 'blind')       // 发起告警的遇险者
    const helper = await reg('ackhelper', 'helper')      // 已接受的亲友
    const stranger = await reg('ackstranger', 'helper')  // 非亲友
    const ownerAuth = { authorization: `Bearer ${owner.token}` }
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: ownerAuth,
      payload: { username: 'ackhelper', relation: '家人', isEmergency: true } })
    await a.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`,
      headers: { authorization: `Bearer ${helper.token}` } })
    const ownerId = store.findByUsername('acksender')!.id
    return { a, store, owner, helper, stranger, ownerId }
  }
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

  it('亲友确认 → 发起人收到 emergency_ack 通知（带确认者名）；非亲友 403；不能确认自己的 400', async () => {
    const { a, store, owner, helper, stranger, ownerId } = await seed()
    const ok = await a.inject({ method: 'POST', url: '/api/emergency/ack', headers: bearer(helper.token),
      payload: { fromId: ownerId, eventId: 'ev1' } })
    expect(ok.statusCode).toBe(200)
    const ack = store.notificationsForUser(ownerId).find((n) => n.kind === 'emergency_ack')
    expect(ack).toBeTruthy()
    expect(ack!.title).toContain('ackhelper')                 // 回告带确认者显示名
    expect(ack!.data).toMatchObject({ kind: 'emergency_ack', fromId: store.findByUsername('ackhelper')!.id })

    // 非亲友确认 → 403（防陌生人给遇险者发"已看到"骚扰）。
    const forbidden = await a.inject({ method: 'POST', url: '/api/emergency/ack', headers: bearer(stranger.token),
      payload: { fromId: ownerId } })
    expect(forbidden.statusCode).toBe(403)
    expect(forbidden.json()).toMatchObject({ error: 'not_contact' })

    // 不能确认自己的告警 → 400。
    const self = await a.inject({ method: 'POST', url: '/api/emergency/ack', headers: bearer(owner.token),
      payload: { fromId: ownerId } })
    expect(self.statusCode).toBe(400)
    await a.close()
  })

  it('去重：同一亲友对同一事件多次确认，只回告发起人一次（不轰炸遇险者）', async () => {
    const { a, store, helper, ownerId } = await seed()
    const ack = () => a.inject({ method: 'POST', url: '/api/emergency/ack', headers: bearer(helper.token),
      payload: { fromId: ownerId, eventId: 'evX' } })
    const r1 = await ack(); const r2 = await ack(); const r3 = await ack()
    expect(r1.statusCode).toBe(200); expect(r2.statusCode).toBe(200); expect(r3.statusCode).toBe(200)
    expect(r2.json()).toMatchObject({ deduped: true })
    const acks = store.notificationsForUser(ownerId).filter((n) => n.kind === 'emergency_ack')
    expect(acks.length).toBe(1) // 只一条回告
    await a.close()
  })
})

// 报平安（all-clear）：告警发出后发起人确认没事 → 广播给所有已接受亲友，让担心的人安心（安全类标配"解除"闭环）。
describe('紧急报平安 /api/emergency/all-clear', () => {
  async function seed() {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const owner = await reg('clearsender', 'blind')
    const helper = await reg('clearhelper', 'helper')
    const ownerAuth = { authorization: `Bearer ${owner.token}` }
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: ownerAuth,
      payload: { username: 'clearhelper', relation: '家人', isEmergency: true } })
    await a.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`,
      headers: { authorization: `Bearer ${helper.token}` } })
    const helperId = store.findByUsername('clearhelper')!.id
    return { a, store, owner, helperId }
  }

  it('发起人报平安 → 每个已接受亲友收到 emergency_clear 通知（带 alertId）', async () => {
    const { a, store, owner, helperId } = await seed()
    const res = await a.inject({ method: 'POST', url: '/api/emergency/all-clear',
      headers: { authorization: `Bearer ${owner.token}` }, payload: { alertId: 'a1' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, notified: 1 })
    const clear = store.notificationsForUser(helperId).find((n) => n.kind === 'emergency_clear')
    expect(clear).toBeTruthy()
    expect(clear!.title).toContain('clearsender')          // 谁报的平安
    expect(clear!.data).toMatchObject({ kind: 'emergency_clear', alertId: 'a1' }) // 带 alertId 供客户端消对应告警模态
  })

  it('去重：同一 alertId 多次报平安只广播一次；未登录 401', async () => {
    const { a, store, owner, helperId } = await seed()
    const clr = () => a.inject({ method: 'POST', url: '/api/emergency/all-clear',
      headers: { authorization: `Bearer ${owner.token}` }, payload: { alertId: 'a2' } })
    await clr(); const r2 = await clr()
    expect(r2.json()).toMatchObject({ deduped: true })
    expect(store.notificationsForUser(helperId).filter((n) => n.kind === 'emergency_clear').length).toBe(1)
    expect((await a.inject({ method: 'POST', url: '/api/emergency/all-clear', payload: { alertId: 'x' } })).statusCode).toBe(401)
    await a.close()
  })
})
