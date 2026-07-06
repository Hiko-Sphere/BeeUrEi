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

  it('onMyWay=true → 发起人收到"X 正在赶来"（比"已看到"更进一步）+ data.onMyWay 供客户端醒目渲染', async () => {
    const { a, store, helper, ownerId } = await seed()
    const way = await a.inject({ method: 'POST', url: '/api/emergency/ack', headers: bearer(helper.token),
      payload: { fromId: ownerId, eventId: 'evway', onMyWay: true } })
    expect(way.statusCode).toBe(200)
    const ack = store.notificationsForUser(ownerId).find((n) => n.kind === 'emergency_ack')!
    expect(ack.data).toMatchObject({ onMyWay: '1' }) // 语言无关的核心信号
    expect(ack.title).toContain('正在赶来')           // 遇险者收到"X 正在赶来"（默认中文）
    await a.close()
  })

  it('缺省 onMyWay → 仍是普通"已看到"回执（向后兼容：旧客户端不带此字段行为不变）', async () => {
    const { a, store, helper, ownerId } = await seed()
    const seen = await a.inject({ method: 'POST', url: '/api/emergency/ack', headers: bearer(helper.token),
      payload: { fromId: ownerId, eventId: 'evseen' } })
    expect(seen.statusCode).toBe(200)
    const ack = store.notificationsForUser(ownerId).find((n) => n.kind === 'emergency_ack')!
    expect(ack.data?.onMyWay).toBeUndefined() // 不带 onMyWay
    expect(ack.title).toContain('已看到')       // "X 已看到你的求助"
    await a.close()
  })
})

// 响应者协调：第一位亲友响应 → **安静**通知其余亲友"已有人在处理"（避免全体同时赶去/都以为别人在管）。
describe('紧急响应者协调 /api/emergency/ack → emergency_responding', () => {
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
  async function seed() {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const owner = await reg('crsender', 'blind')     // 遇险者
    const h1 = await reg('crhelper1', 'helper')      // 亲友 A（响应者）
    const h2 = await reg('crhelper2', 'helper')      // 亲友 B（应收"有人在响应"）
    for (const u of ['crhelper1', 'crhelper2']) {
      const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: bearer(owner.token),
        payload: { username: u, relation: '家人', isEmergency: true } })
      const tok = u === 'crhelper1' ? h1.token : h2.token
      await a.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`, headers: bearer(tok) })
    }
    const ownerId = store.findByUsername('crsender')!.id
    const h1Id = store.findByUsername('crhelper1')!.id
    const h2Id = store.findByUsername('crhelper2')!.id
    // 发一次真实告警，拿到真实 eventId。
    await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: bearer(owner.token), payload: { kind: 'manual' } })
    const eventId = store.emergencyEventsForUser(ownerId)[0].id
    return { a, store, owner, h1, h2, ownerId, h1Id, h2Id, eventId }
  }
  const responding = (store: MemoryStore, uid: string) =>
    store.notificationsForUser(uid).filter((n) => n.kind === 'emergency_responding')

  it('首个响应者确认 → 其余亲友收到 emergency_responding（匿名）；响应者本人与发起人都不收到该协调通知', async () => {
    const { a, store, h1, ownerId, h1Id, h2Id, eventId } = await seed()
    const r = await a.inject({ method: 'POST', url: '/api/emergency/ack', headers: bearer(h1.token), payload: { fromId: ownerId, eventId } })
    expect(r.statusCode).toBe(200)
    // B 收到协调通知；匿名（不含响应者 h1 的名字），但带遇险者名与 eventId。
    expect(responding(store, h2Id)).toHaveLength(1)
    expect(responding(store, h2Id)[0].kind).toBe('emergency_responding')
    expect(responding(store, h2Id)[0].title).toContain('crsender')     // 遇险者名（协调对象）
    expect(responding(store, h2Id)[0].title).not.toContain('crhelper1') // 匿名：不点名响应者
    expect(responding(store, h2Id)[0].data).toMatchObject({ eventId })
    // 响应者本人不收到"有人在响应"（他就是那个人）；发起人收到的是 ack 回执、不是 responding。
    expect(responding(store, h1Id)).toHaveLength(0)
    expect(responding(store, ownerId)).toHaveLength(0)
    await a.close()
  })

  it('第二位亲友再确认 → 不重复广播协调通知（一次事件一条）', async () => {
    const { a, store, h1, h2, ownerId, h1Id, h2Id, eventId } = await seed()
    await a.inject({ method: 'POST', url: '/api/emergency/ack', headers: bearer(h1.token), payload: { fromId: ownerId, eventId } })
    expect(responding(store, h2Id)).toHaveLength(1)
    // B 也确认（成为响应者）→ 不再向 A 广播（已确认过，isFirstAck=false）。
    await a.inject({ method: 'POST', url: '/api/emergency/ack', headers: bearer(h2.token), payload: { fromId: ownerId, eventId } })
    expect(responding(store, h1Id)).toHaveLength(0) // A 不因 B 的确认收到协调通知
    expect(responding(store, h2Id)).toHaveLength(1) // B 仍只有最初那条
    await a.close()
  })

  it('伪造/不存在的 eventId 不触发协调广播（防捏造事件骚扰其余亲友）', async () => {
    const { a, store, h1, ownerId, h2Id } = await seed()
    await a.inject({ method: 'POST', url: '/api/emergency/ack', headers: bearer(h1.token), payload: { fromId: ownerId, eventId: 'totally-fake-id' } })
    expect(responding(store, h2Id)).toHaveLength(0) // 无真实事件 → 不广播
    await a.close()
  })

  it('首个响应者带 onMyWay → 其余亲友收到"有人正赶去"变体 + rData.onMyWay（更可安心待命）', async () => {
    const { a, store, h1, ownerId, h2Id, eventId } = await seed()
    await a.inject({ method: 'POST', url: '/api/emergency/ack', headers: bearer(h1.token), payload: { fromId: ownerId, eventId, onMyWay: true } })
    const r = responding(store, h2Id)
    expect(r).toHaveLength(1)
    expect(r[0].data).toMatchObject({ onMyWay: '1' })
    expect(r[0].title).toContain('正赶去')        // "已有人正赶去 X 那里"（区别于普通"已有人在响应"）
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

  it('报平安把该用户最近的紧急事件标记为已解除（admin 事件列表可区分误报/已解除）', async () => {
    const { a, store, owner } = await seed()
    const ownerId = store.findByUsername('clearsender')!.id
    // 先发一次告警（落一条事件），再报平安
    await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: { authorization: `Bearer ${owner.token}` }, payload: { kind: 'manual' } })
    expect(store.emergencyEventsForUser(ownerId)[0].resolvedAt).toBeUndefined()
    await a.inject({ method: 'POST', url: '/api/emergency/all-clear', headers: { authorization: `Bearer ${owner.token}` }, payload: { alertId: 'aX' } })
    expect(store.emergencyEventsForUser(ownerId)[0].resolvedAt).toBeTruthy() // 事件已被标记解除
    await a.close()
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
