import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { type WebPushSender, type WebPushSubscriptionKeys } from '../src/push/webPush'

// 已配置的 Web 推送替身（configured=true）：证明 Web 订阅也算"可即时触达"。
class ConfiguredWebPush implements WebPushSender {
  readonly configured = true
  async send(_s: WebPushSubscriptionKeys, _p: string): Promise<'sent'> { return 'sent' }
}

const reg = async (a: ReturnType<typeof buildApp>, u: string, role = 'family') =>
  (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()

// 应急就绪自检：遇险前就告诉本人紧急联系人此刻能不能收到**即时告警**（无推送者仍会进收件箱，只是不即时）。
describe('GET /api/emergency/readiness（应急就绪自检）', () => {
  it('无紧急联系人 → hasEmergencyContact=false，total/reachable=0，contacts 空', async () => {
    const a = buildApp(new MemoryStore())
    const me = await reg(a, 'rdyme', 'blind')
    const res = await a.inject({ method: 'GET', url: '/api/emergency/readiness', headers: { authorization: `Bearer ${me.token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 0, acceptedReachable: 0, contacts: [] })
    await a.close()
  })

  it('有 accepted 联系人但都非紧急 → hasEmergencyContact=false 但 acceptedTotal/acceptedReachable 反映全体（修真警报根因）', async () => {
    // 关键：SOS/摔倒告警扇给全体 accepted，故就绪须暴露 acceptedTotal/acceptedReachable——否则 web 会
    // 据 hasEmergencyContact=false 误报"无人会被通知"，而其实这些非紧急联系人都会收到告警。
    const store = new MemoryStore()
    const a = buildApp(store)
    const me = await reg(a, 'rdyacc', 'blind')
    const helper1 = await reg(a, 'helperone')
    const helper2 = await reg(a, 'helpertwo')
    store.updateUser(helper1.user.id, { apnsToken: 'a'.repeat(64) }) // 可即时触达
    store.createLink({ id: 'la1', ownerId: me.user.id, memberId: helper1.user.id, relation: '协助者', isEmergency: false, createdAt: 1, status: 'accepted' })
    store.createLink({ id: 'la2', ownerId: me.user.id, memberId: helper2.user.id, relation: '协助者', isEmergency: false, createdAt: 2, status: 'accepted' })
    const body = (await a.inject({ method: 'GET', url: '/api/emergency/readiness', headers: { authorization: `Bearer ${me.token}` } })).json()
    expect(body.hasEmergencyContact).toBe(false) // 没指定紧急联系人
    expect(body.total).toBe(0)
    expect(body.acceptedTotal).toBe(2)           // 但有 2 位 accepted 联系人会被告警
    expect(body.acceptedReachable).toBe(1)       // 其中 1 位可即时触达
    await a.close()
  })

  it('有 APNs token=可即时触达；无任何推送通道=不可；非紧急/待接受不计入', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const me = await reg(a, 'rdyme2', 'blind')
    const withPush = await reg(a, 'haspush')
    const noPush = await reg(a, 'nopush')
    const nonEmerg = await reg(a, 'plainfriend')
    const pendingEmerg = await reg(a, 'pendingfriend')
    store.updateUser(withPush.user.id, { apnsToken: 'a'.repeat(64) }) // 有 APNs token → 即时触达
    store.createLink({ id: 'l-has', ownerId: me.user.id, memberId: withPush.user.id, relation: '家人', isEmergency: true, createdAt: 1000, status: 'accepted' })
    store.createLink({ id: 'l-no', ownerId: me.user.id, memberId: noPush.user.id, relation: '家人', isEmergency: true, createdAt: 2000, status: 'accepted' })
    store.createLink({ id: 'l-plain', ownerId: me.user.id, memberId: nonEmerg.user.id, relation: '朋友', isEmergency: false, createdAt: 3000, status: 'accepted' }) // 非紧急：不计入
    store.createLink({ id: 'l-pend', ownerId: me.user.id, memberId: pendingEmerg.user.id, relation: '家人', isEmergency: true, createdAt: 4000, status: 'pending' }) // 未接受：不计入

    const body = (await a.inject({ method: 'GET', url: '/api/emergency/readiness', headers: { authorization: `Bearer ${me.token}` } })).json()
    expect(body.total).toBe(2)                 // 仅 accepted ∧ isEmergency
    expect(body.reachable).toBe(1)             // 仅 withPush
    expect(body.hasEmergencyContact).toBe(true)
    expect(body.acceptedTotal).toBe(3)         // 全体 accepted（withPush+noPush+nonEmerg，pending 不计）
    expect(body.acceptedReachable).toBe(1)     // 全体 accepted 中仅 withPush 可即时触达
    const byName = Object.fromEntries((body.contacts as { name: string; reachable: boolean }[]).map((c) => [c.name, c.reachable]))
    expect(byName['haspush']).toBe(true)
    expect(byName['nopush']).toBe(false)
    expect('plainfriend' in byName).toBe(false)    // 非紧急不出现
    expect('pendingfriend' in byName).toBe(false)  // pending 不出现
    await a.close()
  })

  it('Web 推送订阅也算可即时触达（webPush 已配置时）', async () => {
    const store = new MemoryStore()
    const a = buildApp(store, { webPushSender: new ConfiguredWebPush() })
    const me = await reg(a, 'rdyme3', 'blind')
    const webOnly = await reg(a, 'webonly')
    store.createLink({ id: 'l-web', ownerId: me.user.id, memberId: webOnly.user.id, relation: '家人', isEmergency: true, createdAt: 1000, status: 'accepted' })
    store.upsertWebPushSubscription({ endpoint: 'https://push.example/webonly', userId: webOnly.user.id, p256dh: 'k', auth: 'x', createdAt: 1 }) // 无 APNs、有 Web 订阅
    expect((await a.inject({ method: 'GET', url: '/api/emergency/readiness', headers: { authorization: `Bearer ${me.token}` } })).json())
      .toMatchObject({ total: 1, reachable: 1 })
    await a.close()
  })

  it('Web 推送**未配置**时，仅有 Web 订阅的联系人不算可触达（VAPID 没配则 web 推送到不了）', async () => {
    const store = new MemoryStore()
    const a = buildApp(store) // 默认 NoopWebPushSender：configured=false
    const me = await reg(a, 'rdyme4', 'blind')
    const webOnly = await reg(a, 'webonly2')
    store.createLink({ id: 'l-web2', ownerId: me.user.id, memberId: webOnly.user.id, relation: '家人', isEmergency: true, createdAt: 1000, status: 'accepted' })
    store.upsertWebPushSubscription({ endpoint: 'https://push.example/webonly2', userId: webOnly.user.id, p256dh: 'k', auth: 'x', createdAt: 1 })
    expect((await a.inject({ method: 'GET', url: '/api/emergency/readiness', headers: { authorization: `Bearer ${me.token}` } })).json())
      .toMatchObject({ total: 1, reachable: 0 }) // web 推送未配置 → 该订阅不算即时通道
    await a.close()
  })

  it('无鉴权 → 401', async () => {
    const a = buildApp(new MemoryStore())
    expect((await a.inject({ method: 'GET', url: '/api/emergency/readiness' })).statusCode).toBe(401)
    await a.close()
  })
})
