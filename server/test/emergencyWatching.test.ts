import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'

// 我负责的人当前未解除的紧急 GET /api/emergency/watching：漏看推送兜底。仅"把我设为 accepted 紧急联系人"的人、
// 仅未解除、仅近 24h。隐私一致（我本就是其 accepted 紧急联系人、会收到告警）。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const now = Date.now()

describe('GET /api/emergency/watching', () => {
  it('只返回"把我设为 accepted 紧急联系人"的人、未解除、近 24h 的紧急；已解除/超期/非紧急联系人/非紧急链均排除', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const helper = await reg('ewHelper', 'helper')   // 我（紧急联系人）
    const mom = await reg('ewMom', 'blind')           // 把我设为紧急联系人，有未解除紧急
    const dad = await reg('ewDad', 'blind')           // 把我设为紧急联系人，但紧急已解除
    const plain = await reg('ewPlain', 'blind')       // 把我设为**非紧急**联系人（不该出现）
    const stranger = await reg('ewStranger', 'blind') // 有紧急，但没把我设为联系人（不该出现）
    // 建链：owner 设 helper 为紧急联系人（accepted）。
    const link = (owner: { user: { id: string } }, isEmergency: boolean, id: string) =>
      store.createLink({ id, ownerId: owner.user.id, memberId: helper.user.id, relation: '家人', isEmergency, createdAt: 1, status: 'accepted' })
    link(mom, true, 'l1'); link(dad, true, 'l2'); link(plain, false, 'l3') // stranger 无链
    // 紧急事件。
    store.createEmergencyEvent({ id: 'e-mom', userId: mom.user.id, kind: 'fall', notified: 1, contacts: 1, at: now - 60_000 }) // 未解除、近
    store.createEmergencyEvent({ id: 'e-dad', userId: dad.user.id, kind: 'manual', notified: 1, contacts: 1, at: now - 60_000, resolvedAt: now }) // 已解除
    store.createEmergencyEvent({ id: 'e-mom-old', userId: mom.user.id, kind: 'fall', notified: 1, contacts: 1, at: now - 25 * 3600_000 }) // 超 24h
    store.createEmergencyEvent({ id: 'e-plain', userId: plain.user.id, kind: 'fall', notified: 1, contacts: 1, at: now - 60_000 }) // 非紧急联系人
    store.createEmergencyEvent({ id: 'e-str', userId: stranger.user.id, kind: 'fall', notified: 1, contacts: 1, at: now - 60_000 }) // 无链

    const r = await app.inject({ method: 'GET', url: '/api/emergency/watching', headers: auth(helper.token) })
    expect(r.statusCode).toBe(200)
    const active = r.json().active
    expect(active.map((a: { eventId: string }) => a.eventId)).toEqual(['e-mom']) // 恰只有 mom 的未解除、近 24h 的
    expect(active[0]).toMatchObject({ ownerName: 'ewMom', kind: 'fall', acked: false, escalated: false, hasMedical: false })
    // mom 填了医疗信息 → hasMedical 变 true（响应者据此一键查看）。
    store.setMedicalInfo({ userId: mom.user.id, sealed: '{"enc":"x"}', updatedAt: Date.now() }) // 存在即 hasMedical（内容加密，服务端不解）
    const withMed = (await app.inject({ method: 'GET', url: '/api/emergency/watching', headers: auth(helper.token) })).json().active
    expect(withMed[0].hasMedical).toBe(true)
    // 拉黑即撤回（用户确认=完全排除被拉黑联系人，2026-07-11）：mom 拉黑 helper 后，mom 的进行中紧急**整条**
    // 从 helper 的看板消失——否则被拉黑的 helper 只需轮询本端点即可绕过"告警不推给被拉黑者"，照样拿到 mom 的
    // 实时坐标（对抗复审 F1 的对称面：pull 与 push 须一致排除）。
    store.createBlock({ id: 'blk1', blockerId: mom.user.id, blockedId: helper.user.id, createdAt: Date.now() })
    const blocked = (await app.inject({ method: 'GET', url: '/api/emergency/watching', headers: auth(helper.token) })).json().active
    expect(blocked).toEqual([]) // mom 被排除，看板空（不再是"仍在列表但 hasMedical=false"）
    await app.close()
  })

  it('带出位置来源与新鲜度 locSource/locAgeSec（协助者据此辨实时 vs 最后已知，绝不照旧坐标扑空）', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const helper = await reg('ewlHelper', 'helper')
    const mom = await reg('ewlMom', 'blind')       // 手机丢 GPS → 告警附「最后已知」坐标
    const dad = await reg('ewlDad', 'blind')       // 实时坐标
    const gramps = await reg('ewlGramps', 'blind') // 完全无坐标
    for (const [o, id] of [[mom, 'lm'], [dad, 'ld'], [gramps, 'lg']] as const)
      store.createLink({ id, ownerId: o.user.id, memberId: helper.user.id, relation: '家人', isEmergency: true, createdAt: 1, status: 'accepted' })
    store.createEmergencyEvent({ id: 'e-mom', userId: mom.user.id, kind: 'fall', notified: 1, contacts: 1, at: now - 60_000, lat: 31.2, lon: 121.4, locSource: 'lastKnown', locAgeSec: 600 })
    store.createEmergencyEvent({ id: 'e-dad', userId: dad.user.id, kind: 'manual', notified: 1, contacts: 1, at: now - 50_000, lat: 39.9, lon: 116.4, locSource: 'live' })
    store.createEmergencyEvent({ id: 'e-gramps', userId: gramps.user.id, kind: 'crash', notified: 0, contacts: 1, at: now - 40_000 }) // 无坐标

    const active = (await app.inject({ method: 'GET', url: '/api/emergency/watching', headers: auth(helper.token) })).json().active
    const byId = Object.fromEntries(active.map((a: { eventId: string }) => [a.eventId, a]))
    // 最后已知：坐标 + locSource='lastKnown' + locAgeSec 秒数，供客户端诚实标注"最后位置·N 分钟前"。
    expect(byId['e-mom']).toMatchObject({ lat: 31.2, lon: 121.4, locSource: 'lastKnown', locAgeSec: 600 })
    // 实时：locSource='live'、无 locAgeSec（null）。
    expect(byId['e-dad']).toMatchObject({ lat: 39.9, lon: 116.4, locSource: 'live', locAgeSec: null })
    // 无坐标：lat/lon/locSource/locAgeSec 全 null（客户端不显地图链接）。
    expect(byId['e-gramps']).toMatchObject({ lat: null, lon: null, locSource: null, locAgeSec: null })
    await app.close()
  })

  it('无人处于紧急 → active 空数组；ack/escalate 状态如实带出', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const helper = await reg('ew2Helper', 'helper')
    expect((await app.inject({ method: 'GET', url: '/api/emergency/watching', headers: auth(helper.token) })).json()).toEqual({ active: [] })
    // 有一条已 ack + 已 escalate 的未解除紧急 → acked/escalated=true。
    const mom = await reg('ew2Mom', 'blind')
    store.createLink({ id: 'l1', ownerId: mom.user.id, memberId: helper.user.id, relation: '家人', isEmergency: true, createdAt: 1, status: 'accepted' })
    store.createEmergencyEvent({ id: 'e1', userId: mom.user.id, kind: 'crash', notified: 1, contacts: 1, at: now - 60_000 })
    store.markEmergencyAcked('e1', now - 30_000); store.markEmergencyEscalated('e1', now - 20_000)
    const active = (await app.inject({ method: 'GET', url: '/api/emergency/watching', headers: auth(helper.token) })).json().active
    expect(active[0]).toMatchObject({ eventId: 'e1', acked: true, escalated: true })
    await app.close()
  })

  it('onWay：有人"正在赶来"→ 看板 onWay=true（比 acked 更强的持久安心信号）；仅"已看到"→ onWay=false', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const helper = await reg('ewwHelper', 'helper')
    const mom = await reg('ewwMom', 'blind')
    const dad = await reg('ewwDad', 'blind')
    store.createLink({ id: 'lm', ownerId: mom.user.id, memberId: helper.user.id, relation: '家人', isEmergency: true, createdAt: 1, status: 'accepted' })
    store.createLink({ id: 'ld', ownerId: dad.user.id, memberId: helper.user.id, relation: '家人', isEmergency: true, createdAt: 1, status: 'accepted' })
    store.createEmergencyEvent({ id: 'e-mom', userId: mom.user.id, kind: 'fall', notified: 1, contacts: 1, at: now - 60_000 })
    store.markEmergencyAcked('e-mom', now - 30_000); store.markEmergencyOnWay('e-mom', now - 25_000) // 有人正在赶来
    store.createEmergencyEvent({ id: 'e-dad', userId: dad.user.id, kind: 'fall', notified: 1, contacts: 1, at: now - 60_000 })
    store.markEmergencyAcked('e-dad', now - 20_000) // 仅"已看到"，未上路
    const active = (await app.inject({ method: 'GET', url: '/api/emergency/watching', headers: auth(helper.token) })).json().active
    const byId = Object.fromEntries(active.map((a: { eventId: string }) => [a.eventId, a]))
    expect(byId['e-mom']).toMatchObject({ acked: true, onWay: true })
    expect(byId['e-dad']).toMatchObject({ acked: true, onWay: false })
    await app.close()
  })

  it('SqliteStore：markEmergencyOnWay 只记首个、往返读回 onWayAt（列存取一致）', () => {
    const s = new SqliteStore(':memory:')
    s.createEmergencyEvent({ id: 'e1', userId: 'u1', kind: 'fall', notified: 1, contacts: 1, at: now })
    expect(s.emergencyEventsForUser('u1')[0].onWayAt).toBeUndefined()
    s.markEmergencyOnWay('e1', 1000); s.markEmergencyOnWay('e1', 2000) // 第二次不覆盖
    expect(s.emergencyEventsForUser('u1')[0].onWayAt).toBe(1000)
  })

  it('分诊排序：升级后仍无人响应 > 尚无人响应 > 已有人响应（最需行动者置顶，非只按时间）', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const helper = await reg('ew3Helper', 'helper')
    const mkOwner = async (name: string, id: string) => {
      const o = await reg(name, 'blind')
      store.createLink({ id: `l-${id}`, ownerId: o.user.id, memberId: helper.user.id, relation: '家人', isEmergency: true, createdAt: 1, status: 'accepted' })
      return o
    }
    const acked = await mkOwner('ewAcked', 'a')
    const unacked = await mkOwner('ewUnacked', 'u')
    const escal = await mkOwner('ewEscal', 'e')
    // acked 的最新（at 最大），escalated-unanswered 的最旧（at 最小）——若只按时间会把最紧急的排最后。
    store.createEmergencyEvent({ id: 'e-acked', userId: acked.user.id, kind: 'fall', notified: 1, contacts: 1, at: now - 10_000 })
    store.markEmergencyAcked('e-acked', now - 5_000)
    store.createEmergencyEvent({ id: 'e-unacked', userId: unacked.user.id, kind: 'fall', notified: 1, contacts: 1, at: now - 30_000 })
    store.createEmergencyEvent({ id: 'e-escal', userId: escal.user.id, kind: 'fall', notified: 1, contacts: 1, at: now - 60_000 })
    store.markEmergencyEscalated('e-escal', now - 50_000)

    const active = (await app.inject({ method: 'GET', url: '/api/emergency/watching', headers: auth(helper.token) })).json().active
    expect(active.map((a: { eventId: string }) => a.eventId)).toEqual(['e-escal', 'e-unacked', 'e-acked']) // 分诊优先于时间
    await app.close()
  })

  it('未登录 → 401', async () => {
    const app = buildApp(new MemoryStore())
    expect((await app.inject({ method: 'GET', url: '/api/emergency/watching' })).statusCode).toBe(401)
    await app.close()
  })

  it('安全攸关：某 owner 医疗读抛错（SQLITE_BUSY 等）不使整个看板 500——非必需子读绝不让协助者对其余紧急失明', async () => {
    // getMedicalInfo 只决定 hasMedical 附加标志（非看板核心「谁在紧急」）：同步抛不能把整个 GET 500 掉。
    class ThrowingMedicalStore extends MemoryStore {
      getMedicalInfo(_userId: string): undefined { throw new Error('SQLITE_BUSY: database is locked') }
    }
    const store = new ThrowingMedicalStore()
    const app = buildApp(store)
    const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const helper = await reg('twHelper', 'helper')
    const mom = await reg('twMom', 'blind')
    store.createLink({ id: 'l1', ownerId: mom.user.id, memberId: helper.user.id, relation: '家人', isEmergency: true, createdAt: 1, status: 'accepted' })
    store.createEmergencyEvent({ id: 'e1', userId: mom.user.id, kind: 'fall', notified: 1, contacts: 1, at: now - 60_000 })
    const r = await app.inject({ method: 'GET', url: '/api/emergency/watching', headers: auth(helper.token) })
    expect(r.statusCode).toBe(200)                 // 医疗读抛错不 500 掉看板
    const active = r.json().active
    expect(active.map((a: { eventId: string }) => a.eventId)).toEqual(['e1']) // 紧急仍照常列出（协助者不失明）
    expect(active[0].hasMedical).toBe(false)       // 读失败 → 退化为不标（隐私侧也安全）
    await app.close()
  })
})
