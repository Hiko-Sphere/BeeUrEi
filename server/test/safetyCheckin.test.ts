import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type SafetyTimer, type Store } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { NoopPushSender } from '../src/push/apns'
import { NoopWebPushSender } from '../src/push/webPush'
import { fireExpiredSafetyTimers } from '../src/safety/checkin'
import { cascadeDeleteUser } from '../src/db/cascade'

async function setup(store: Store = new MemoryStore()) {
  const app = buildApp(store)
  const reg = async (u: string, role: string) => {
    const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    return { id: r.user.id as string, h: { authorization: `Bearer ${r.token}` } }
  }
  const blind = await reg('stblind', 'blind')
  const family = await reg('stfamily', 'family')
  const stranger = await reg('ststranger', 'helper')
  const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: blind.h,
    payload: { username: 'stfamily', relation: '家人', isEmergency: true } })
  await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: family.h })
  return { app, store, blind, family, stranger }
}
const missed = (store: Store, uid: string) =>
  store.notificationsForUser(uid).filter((n) => n.kind === 'emergency_alert' && n.data?.kind === 'checkin')

describe('安全报到端点', () => {
  it('start 建 active + GET 返回剩余时间；重开取消旧的（至多一个 active）', async () => {
    const { app, store, blind } = await setup()
    const s1 = await app.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: blind.h, payload: { durationMinutes: 30, note: '步行回家' } })
    expect(s1.statusCode).toBe(200)
    expect(s1.json().timer.status).toBe('active')
    expect(s1.json().timer.remainingSec).toBeGreaterThan(1700) // ~1800s

    const g = await app.inject({ method: 'GET', url: '/api/safety/checkin', headers: blind.h })
    expect(g.json().timer.id).toBe(s1.json().timer.id)
    expect(g.json().timer.note).toBe('步行回家')

    const s2 = await app.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: blind.h, payload: { durationMinutes: 60 } })
    expect(s2.json().timer.id).not.toBe(s1.json().timer.id) // 新计时器
    // 只剩一个 active（旧的被取消）
    expect(store.safetyTimersForUser(blind.id).filter((t) => t.status === 'active')).toHaveLength(1)
    expect(store.getSafetyTimer(s1.json().timer.id)?.status).toBe('canceled')
    await app.close()
  })

  it('complete 报平安结束 active；无 active → completed:false（幂等友好）', async () => {
    const { app, blind } = await setup()
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/complete', headers: blind.h })).json()).toEqual({ ok: true, completed: false })
    await app.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: blind.h, payload: { durationMinutes: 30 } })
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/complete', headers: blind.h })).json()).toEqual({ ok: true, completed: true })
    expect((await app.inject({ method: 'GET', url: '/api/safety/checkin', headers: blind.h })).json().timer).toBeNull()
    await app.close()
  })

  it('cancel 取消 active；无 active → canceled:false', async () => {
    const { app, blind } = await setup()
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/cancel', headers: blind.h })).json()).toEqual({ ok: true, canceled: false })
    await app.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: blind.h, payload: { durationMinutes: 30 } })
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/cancel', headers: blind.h })).json()).toEqual({ ok: true, canceled: true })
    await app.close()
  })

  it('extend 顺延 dueAt；无 active → 404；封顶 now+24h', async () => {
    const { app, store, blind } = await setup()
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/extend', headers: blind.h, payload: { addMinutes: 15 } })).statusCode).toBe(404)
    const s = await app.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: blind.h, payload: { durationMinutes: 30 } })
    const due0 = s.json().timer.dueAt
    const e = await app.inject({ method: 'POST', url: '/api/safety/checkin/extend', headers: blind.h, payload: { addMinutes: 20 } })
    expect(e.json().timer.dueAt).toBe(due0 + 20 * 60_000)
    // 封顶：从 23h55m 再加 30m 不超过 now+24h
    store.updateSafetyTimer(s.json().timer.id, { dueAt: Date.now() + (23 * 60 + 55) * 60_000 })
    const e2 = await app.inject({ method: 'POST', url: '/api/safety/checkin/extend', headers: blind.h, payload: { addMinutes: 30 } })
    expect(e2.json().timer.dueAt).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60_000 + 1000)
    await app.close()
  })

  it('校验：时长越界 400、缺字段 400、违禁词备注 403、无鉴权 401', async () => {
    const { app, store, blind } = await setup()
    store.setAppConfig({ contentFilter: { enabled: true, terms: ['敏感词'] } })
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: blind.h, payload: { durationMinutes: 1 } })).statusCode).toBe(400)     // <5
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: blind.h, payload: { durationMinutes: 5000 } })).statusCode).toBe(400)  // >1440
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: blind.h, payload: {} })).statusCode).toBe(400)                         // 缺时长
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: blind.h, payload: { durationMinutes: 30, note: '含敏感词的备注' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/start', payload: { durationMinutes: 30 } })).statusCode).toBe(401)
    await app.close()
  })
})

describe('安全报到到期自动告警（fireExpiredSafetyTimers）', () => {
  const push = new NoopPushSender()
  const webPush = new NoopWebPushSender()
  const GRACE = 60 * 60_000

  it('到期未确认 → 告警 accepted 亲友、不告警陌生人；标 fired + eventId；建 emergency_event(checkin)', async () => {
    const { store, blind, family, stranger } = await setup()
    const now = Date.now()
    const t: SafetyTimer = { id: 'st1', ownerId: blind.id, note: '步行回家', startedAt: now - 30 * 60_000, dueAt: now - 1000, status: 'active' }
    store.createSafetyTimer(t)
    expect(fireExpiredSafetyTimers(store, push, webPush, now, GRACE)).toBe(1)
    // 亲友收到 checkin 告警，陌生人没有
    expect(missed(store, family.id)).toHaveLength(1)
    expect(missed(store, family.id)[0].body).toContain('步行回家')
    expect(missed(store, stranger.id)).toHaveLength(0)
    // 计时器标 fired + eventId
    const after = store.getSafetyTimer('st1')!
    expect(after.status).toBe('fired')
    expect(after.eventId).toBeTruthy()
    // 建了 emergency_event(kind=checkin)，且会被升级重呼扫到（未解除/未确认/未升级）
    const ev = store.emergencyEventsForUser(blind.id)
    expect(ev).toHaveLength(1)
    expect(ev[0].kind).toBe('checkin')
    expect(store.unacknowledgedEmergencyEvents(now, now).some((e) => e.id === after.eventId)).toBe(true)
  })

  it('幂等：再扫不重复告警（已 fired 不在 active 候选里）', async () => {
    const { store, blind, family } = await setup()
    const now = Date.now()
    store.createSafetyTimer({ id: 'st2', ownerId: blind.id, startedAt: now - 60_000, dueAt: now - 1000, status: 'active' })
    expect(fireExpiredSafetyTimers(store, push, webPush, now, GRACE)).toBe(1)
    expect(fireExpiredSafetyTimers(store, push, webPush, now + 5000, GRACE)).toBe(0) // 第二次：0
    expect(missed(store, family.id)).toHaveLength(1) // 只告警一次
  })

  it('陈旧宽限：宕机恢复后已超宽限 → 记 expired、不惊动亲友，但给本人留诚实通知（非静默，对抗复审#2）', async () => {
    const { store, blind, family } = await setup()
    const now = Date.now()
    store.createSafetyTimer({ id: 'st3', ownerId: blind.id, startedAt: now - 3 * 60 * 60_000, dueAt: now - 90 * 60_000, status: 'active' }) // 到期于 90 分钟前
    expect(fireExpiredSafetyTimers(store, push, webPush, now, GRACE)).toBe(0) // 超 60 分钟宽限 → 不告警亲友
    expect(store.getSafetyTimer('st3')!.status).toBe('expired')
    expect(missed(store, family.id)).toHaveLength(0)          // 亲友不被惊动（免误报风暴）
    expect(store.emergencyEventsForUser(blind.id)).toHaveLength(0) // 不建可升级的紧急事件
    // 但本人收到一条诚实通知：断网期间到期、未替你通知亲友（有迹可循、可自救）。
    expect(store.notificationsForUser(blind.id).filter((n) => n.kind === 'safety_checkin_expired')).toHaveLength(1)
  })

  it('到期告警后本人"我平安了"(/complete) 等价 all-clear：解除事件 + 广播亲友安心；再按一次 no-op（对抗复审#1）', async () => {
    const { app, store, blind, family } = await setup()
    const now = Date.now()
    store.createSafetyTimer({ id: 'stC', ownerId: blind.id, note: '走夜路', startedAt: now - 60_000, dueAt: now - 1000, status: 'active' })
    fireExpiredSafetyTimers(store, push, webPush, now, GRACE) // 到期告警：family 收到、事件未解除
    expect(store.emergencyEventsForUser(blind.id)[0].resolvedAt).toBeUndefined()

    const c = await app.inject({ method: 'POST', url: '/api/safety/checkin/complete', headers: blind.h })
    expect(c.json()).toEqual({ ok: true, completed: true, clearedAlarm: true })
    expect(store.emergencyEventsForUser(blind.id)[0].resolvedAt).toBeTruthy() // 事件已解除 → 升级重呼不再骚扰
    expect(store.unacknowledgedEmergencyEvents(now + 10 * 60_000, now + 10 * 60_000)).toHaveLength(0)
    expect(store.notificationsForUser(family.id).filter((n) => n.kind === 'emergency_clear')).toHaveLength(1) // 亲友收到"我没事了"

    // 再按一次：事件已解除 → no-op（不重复广播）
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/complete', headers: blind.h })).json()).toEqual({ ok: true, completed: false })
    await app.close()
  })

  it('未到期/终态计时器不告警', async () => {
    const { store, blind } = await setup()
    const now = Date.now()
    store.createSafetyTimer({ id: 'a', ownerId: blind.id, startedAt: now, dueAt: now + 10 * 60_000, status: 'active' }) // 未到期
    store.createSafetyTimer({ id: 'b', ownerId: blind.id, startedAt: now - 60_000, dueAt: now - 1000, status: 'completed', completedAt: now }) // 已报平安
    store.createSafetyTimer({ id: 'c', ownerId: blind.id, startedAt: now - 60_000, dueAt: now - 1000, status: 'canceled', canceledAt: now })
    expect(fireExpiredSafetyTimers(store, push, webPush, now, GRACE)).toBe(0)
  })

  it('归属者已删号 → 优雅跳过（标 fired、不建事件、不崩）', async () => {
    const { store, blind } = await setup()
    const now = Date.now()
    store.createSafetyTimer({ id: 'd', ownerId: blind.id, startedAt: now - 60_000, dueAt: now - 1000, status: 'active' })
    cascadeDeleteUser(store, blind.id) // 删号会连带清计时器——重建一条模拟"删号与 tick 竞态"下的孤儿
    store.createSafetyTimer({ id: 'd2', ownerId: blind.id, startedAt: now - 60_000, dueAt: now - 1000, status: 'active' })
    expect(() => fireExpiredSafetyTimers(store, push, webPush, now, GRACE)).not.toThrow()
    expect(store.getSafetyTimer('d2')!.status).toBe('fired') // 已标 fired，免反复扫
  })
})

describe('SafetyTimer 存储 parity（Memory ↔ Sqlite）', () => {
  for (const make of [() => new MemoryStore(), () => new SqliteStore(':memory:')]) {
    const store = make()
    const label = store.constructor.name
    it(`${label}: CRUD/active/expired/retention/cascade 一致`, () => {
      const now = 1_000_000
      store.createSafetyTimer({ id: 't1', ownerId: 'u1', note: 'n', startedAt: now, dueAt: now + 60_000, status: 'active' })
      expect(store.getSafetyTimer('t1')).toMatchObject({ id: 't1', ownerId: 'u1', note: 'n', status: 'active' })
      expect(store.activeSafetyTimerForOwner('u1')?.id).toBe('t1')

      // update 合并
      store.updateSafetyTimer('t1', { status: 'fired', firedAt: now + 100, eventId: 'e1' })
      expect(store.getSafetyTimer('t1')).toMatchObject({ status: 'fired', firedAt: now + 100, eventId: 'e1' })
      expect(store.activeSafetyTimerForOwner('u1')).toBeUndefined() // fired 不再 active

      // expiredActive 只挑 active∧到期
      store.createSafetyTimer({ id: 't2', ownerId: 'u1', startedAt: now, dueAt: now - 1, status: 'active' })
      store.createSafetyTimer({ id: 't3', ownerId: 'u2', startedAt: now, dueAt: now + 999, status: 'active' }) // 未到期
      expect(store.expiredActiveSafetyTimers(now).map((t) => t.id)).toEqual(['t2'])

      // 历史倒序
      expect(store.safetyTimersForUser('u1').map((t) => t.id).sort()).toEqual(['t1', 't2'])

      // retention 只清终态；active 永不清
      expect(store.deleteSafetyTimersOlderThan(now + 10)).toBe(1) // 只 t1(fired) 被清，t2(active) 保留
      expect(store.getSafetyTimer('t1')).toBeUndefined()
      expect(store.getSafetyTimer('t2')).toBeTruthy()

      // cascade
      store.deleteSafetyTimersForOwner('u1')
      expect(store.safetyTimersForUser('u1')).toHaveLength(0)
      expect(store.getSafetyTimer('t3')).toBeTruthy() // 别人的不动
    })
  }
})

describe('删号级联清安全报到', () => {
  it('cascadeDeleteUser 清除该用户全部报到', async () => {
    const { store, blind } = await setup()
    store.createSafetyTimer({ id: 'x', ownerId: blind.id, startedAt: 1, dueAt: 2, status: 'active' })
    cascadeDeleteUser(store, blind.id)
    expect(store.safetyTimersForUser(blind.id)).toHaveLength(0)
  })
})
