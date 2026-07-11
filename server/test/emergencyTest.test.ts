import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { isAlwaysThrough } from '../src/notifications/quietHours'

// 测试告警投递 POST /api/emergency/test：用户主动验证告警链路能送达（就绪自检只查"有通道"，测试则真发一条）。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

async function seed() {
  const store = new MemoryStore()
  const app = buildApp(store)
  const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
  const me = await reg('etOwner', 'blind')
  const fam = await reg('etFam', 'family')
  await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(me.token), payload: { username: 'etFam', relation: '家人', isEmergency: true } })
  const inc = await app.inject({ method: 'GET', url: '/api/family/incoming', headers: auth(fam.token) })
  await app.inject({ method: 'POST', url: `/api/family/links/${inc.json().links[0].id}/accept`, headers: auth(fam.token) })
  return { store, app, me, fam }
}

describe('测试告警 POST /api/emergency/test', () => {
  it('给已接受联系人发 delivery_check 站内通知（明确标注测试）；返回 notified/contacts；不建紧急事件', async () => {
    const { store, app, me, fam } = await seed()
    const before = store.recentEmergencyEvents(100).length
    const r = await app.inject({ method: 'POST', url: '/api/emergency/test', headers: auth(me.token), payload: {} })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ ok: true, contacts: 1 })
    const notifs = store.notificationsForUser(fam.user.id).filter((n) => n.kind === 'delivery_check')
    expect(notifs).toHaveLength(1)
    expect(notifs[0].title).toContain('测试告警')       // 明确是测试
    expect(notifs[0].body).toMatch(/测试|忽略/)          // 请忽略、无需行动
    // 绝不建紧急事件（测试不是真求助，不污染 admin 值守/升级链）。
    expect(store.recentEmergencyEvents(100).length).toBe(before)
    // 本人（发起者）不给自己发测试通知。
    expect(store.notificationsForUser(me.user.id).filter((n) => n.kind === 'delivery_check')).toHaveLength(0)
    await app.close()
  })

  it('测试告警 kind=delivery_check 也 always-through（越勿扰真送达，准确反映真实应急投递路径；用户拍板 2026-07-11）', () => {
    // 自测的意义是验证**真实应急投递路径**，而真应急恒 always-through；若自测反受勿扰约束就测不到真实路径
    // （用户在联系人勿扰时段自测、向其核对会误判链路坏）。故自测也 always-through——但它是低调的"测试"通知
    // （客户端渲染为测试、非应急大模态/响铃），送达但不惊扰。
    expect(isAlwaysThrough('delivery_check')).toBe(true)
    expect(isAlwaysThrough('emergency_alert')).toBe(true) // 对照：真实告警仍恒穿透
    // 反向纵深：加 delivery 关键词不误伤——普通软通知仍受勿扰约束。
    expect(isAlwaysThrough('friend_request')).toBe(false)
    expect(isAlwaysThrough('route_added')).toBe(false)
  })

  it('无联系人 → contacts:0 notified:0，仍 200（不报错）', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const solo = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'etSolo', password: 'secret123', role: 'blind' } })).json()
    const r = await app.inject({ method: 'POST', url: '/api/emergency/test', headers: auth(solo.token), payload: {} })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ ok: true, contacts: 0, notified: 0 })
    await app.close()
  })
})
