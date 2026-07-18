import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type SafetyTimer, type Store } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { NoopPushSender, type PushSender } from '../src/push/apns'
import { NoopWebPushSender, type WebPushSender, type WebPushSubscriptionKeys } from '../src/push/webPush'
import { fireExpiredSafetyTimers, remindDueSoonSafetyTimers } from '../src/safety/checkin'
import { cascadeDeleteUser } from '../src/db/cascade'

// 捕获 APNs 告警的 extra，用于断言"未报到告警的推送载荷带 hasMedical"。
class CapturingPush implements PushSender {
  alerts: { token: string; extra?: Record<string, string> }[] = []
  async send(): Promise<void> {}
  async sendCallInvite(): Promise<void> {}
  async sendAlert(token: string, _t: string, _b: string, extra?: Record<string, string>): Promise<void> { this.alerts.push({ token, extra }) }
}

// 记录式 web 推送替身：记下负载，用于断言未报到告警的 web push 顶层带 badge（供 SW 置 PWA 图标角标）。
class RecordingWebPush implements WebPushSender {
  readonly configured = true
  sent: string[] = []
  async send(_sub: WebPushSubscriptionKeys, payload: string): Promise<'sent'> { this.sent.push(payload); return 'sent' }
}

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
const reminders = (store: Store, uid: string) =>
  store.notificationsForUser(uid).filter((n) => n.kind === 'safety_checkin_reminder')

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

  it('start 返回 hasEmergencyContact（防假安心）：有紧急联系人→true；没有→false，与 fire 扇出同口径', async () => {
    const { app, blind, family, stranger } = await setup()
    // blind 把 family 设为紧急联系人（已接受）→ true。
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: blind.h, payload: { durationMinutes: 30 } })).json().hasEmergencyContact).toBe(true)
    // stranger 无任何联系人 → false（到期告警无人可通知）。
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: stranger.h, payload: { durationMinutes: 30 } })).json().hasEmergencyContact).toBe(false)
    // family 是 blind 的紧急联系人，但 family 自己没把谁设为**自己的**紧急联系人（linksByOwner(family) 空）→ false（方向不对称）。
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: family.h, payload: { durationMinutes: 30 } })).json().hasEmergencyContact).toBe(false)
    await app.close()
  })

  it('GET /api/safety/checkin 也带 hasEmergencyContact（供进行中持续预警，非只 start 一刻的 toast）', async () => {
    const { app, blind, stranger } = await setup()
    // blind 有紧急联系人 → true；stranger 无 → false（即便无 active timer 也返回，供持续/空闲态预警）。
    expect((await app.inject({ method: 'GET', url: '/api/safety/checkin', headers: blind.h })).json().hasEmergencyContact).toBe(true)
    expect((await app.inject({ method: 'GET', url: '/api/safety/checkin', headers: stranger.h })).json().hasEmergencyContact).toBe(false)
    await app.close()
  })

  it('start hasEmergencyContact：待接受 / 非紧急的联系人都不算（须 accepted∧isEmergency，与 fire 一致）', async () => {
    const { app } = await setup()
    const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const a = await reg('hecA', 'blind'); const ah = { authorization: `Bearer ${a.token}` }
    await reg('hecB', 'family')
    const c = await reg('hecC', 'family'); const ch = { authorization: `Bearer ${c.token}` }
    // A 把 B 设为紧急联系人但 B **未接受**（pending）→ false。
    await app.inject({ method: 'POST', url: '/api/family/links', headers: ah, payload: { username: 'hecB', relation: '家人', isEmergency: true } })
    expect((await app.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: ah, payload: { durationMinutes: 30 } })).json().hasEmergencyContact).toBe(false)
    // A 再把 C 设为**非紧急**联系人并接受：hasEmergencyContact 仍 false（isEmergency 仅额外授医疗信息），
    // 但 hasAnyContact 现在=true——到期告警**会**发给 C（fireExpiredSafetyTimers 扇给全体 accepted）。
    // 故客户端据 hasAnyContact 才不会误报"无人会被通知"（应急就绪同源真警报修复）。
    const lc = await app.inject({ method: 'POST', url: '/api/family/links', headers: ah, payload: { username: 'hecC', relation: '同事', isEmergency: false } })
    await app.inject({ method: 'POST', url: `/api/family/links/${lc.json().link.id}/accept`, headers: ch })
    const afterC = (await app.inject({ method: 'POST', url: '/api/safety/checkin/start', headers: ah, payload: { durationMinutes: 30 } })).json()
    expect(afterC.hasEmergencyContact).toBe(false) // 仍无 isEmergency 联系人
    expect(afterC.hasAnyContact).toBe(true)         // 但有 accepted 联系人会被告警——不再误报"无人会被通知"
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

  it('被拉黑的紧急联系人完全不收到未报到告警（dead-man switch 同 SOS：拉黑即撤回，不播最后已知 GPS+hasMedical）', async () => {
    const { app, store, blind, family } = await setup()
    const now = Date.now()
    // 再加一名 accepted 紧急联系人 blocked，随后被 blind 拉黑（拉黑不删链、不清 isEmergency）。
    const b = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'stblocked', password: 'secret123', role: 'helper' } })).json()
    store.createLink({ id: 'lblk', ownerId: blind.id, memberId: b.user.id, relation: '家人', isEmergency: true, createdAt: 1, status: 'accepted' })
    store.createBlock({ id: 'ciblk', blockerId: blind.id, blockedId: b.user.id, createdAt: now })
    store.createSafetyTimer({ id: 'stblk', ownerId: blind.id, note: '步行回家', startedAt: now - 30 * 60_000, dueAt: now - 1000, status: 'active' })
    expect(fireExpiredSafetyTimers(store, push, webPush, now, GRACE)).toBe(1)
    // family（未拉黑）收到未报到告警；blocked **一条都没有**（不进其收件箱）。
    expect(missed(store, family.id)).toHaveLength(1)
    expect(missed(store, b.user.id)).toHaveLength(0)
    // 事件 contacts 计数仅含未拉黑者（blocked 被排除出扇出面）。
    expect(store.emergencyEventsForUser(blind.id)[0].contacts).toBe(1)
  })

  it('陈旧超宽限（到期时宕机、恢复已晚 >staleGraceMs）→ 不惊动亲友、标 expired、不建 event、只通知本人（防误报风暴）', async () => {
    const { store, blind, family } = await setup()
    const now = Date.now()
    // dueAt 在 now 之前**超过 GRACE**（模拟到期那刻服务端宕机、恢复时已过宽限）。
    store.createSafetyTimer({ id: 'stStale', ownerId: blind.id, note: '走夜路', startedAt: now - 3 * 60 * 60_000, dueAt: now - GRACE - 60_000, status: 'active' })
    expect(fireExpiredSafetyTimers(store, push, webPush, now, GRACE)).toBe(0) // 不计入"已告警"——陈旧不迟发亲友告警
    expect(missed(store, family.id)).toHaveLength(0)                          // 亲友**不**收 checkin 告警（防恢复后陈旧计时器轰炸）
    expect(store.getSafetyTimer('stStale')!.status).toBe('expired')          // 标 expired（非 fired；admin 可见"曾有一次未能守护"）
    expect(store.emergencyEventsForUser(blind.id)).toHaveLength(0)            // 不建 emergency_event → 不触发升级重呼
    // 但不静默丢弃：本人收到"报到已过期"诚实通知，可自查/重开/手动求助。
    expect(store.notificationsForUser(blind.id).filter((n) => n.kind === 'safety_checkin_expired')).toHaveLength(1)
  })

  it('未报到告警 → 亲友 web push 顶层带 badge（含刚写入的告警通知）→ SW 可置 PWA 图标角标', async () => {
    const { store, blind, family } = await setup()
    const now = Date.now()
    store.upsertWebPushSubscription({ endpoint: 'https://push.example/stfamily', userId: family.id, p256dh: 'k', auth: 'a', createdAt: 1 })
    store.createSafetyTimer({ id: 'stBadge', ownerId: blind.id, note: '走夜路', startedAt: now - 30 * 60_000, dueAt: now - 1000, status: 'active' })
    const web = new RecordingWebPush()
    expect(fireExpiredSafetyTimers(store, push, web, now, GRACE)).toBe(1)
    expect(web.sent.length).toBeGreaterThanOrEqual(1)
    const payload = JSON.parse(web.sent[0])
    expect(typeof payload.badge).toBe('number')     // APNs 一直带 badge，此前 web 漏——顶层带上供 SW 置角标
    expect(payload.badge).toBeGreaterThanOrEqual(1)  // 未报到告警给 family 写了一条 emergency_alert 通知（未读≥1）
    expect(payload.data.kind).toBe('checkin')
  })

  it('发起人有紧急医疗信息 → 未报到告警的**持久化通知 data 与 APNs extra 都带 hasMedical**（跨渠道一致）', async () => {
    const { store, blind, family } = await setup()
    const now = Date.now()
    store.updateUser(family.id, { apnsToken: 'f'.repeat(64) }) // 亲友有 APNs token → 走 sendAlert
    store.setMedicalInfo({ userId: blind.id, sealed: 'sealed-blob', updatedAt: 1 }) // 仅需存在
    store.createSafetyTimer({ id: 'stMed', ownerId: blind.id, note: '走夜路', startedAt: now - 30 * 60_000, dueAt: now - 1000, status: 'active' })
    const capPush = new CapturingPush()
    expect(fireExpiredSafetyTimers(store, capPush, webPush, now, GRACE)).toBe(1)
    // in-app / web push 的 notifData 带（此前已有）。
    expect(missed(store, family.id)[0].data?.hasMedical).toBe('1')
    // APNs extra 也带（本次修复：此前漏，iOS 收到的报到告警不显示"查看医疗信息"）。
    expect(capPush.alerts.find((a) => a.token === 'f'.repeat(64))?.extra?.hasMedical).toBe('1')
  })

  it('发起人无医疗信息 → 未报到告警不带 hasMedical（两渠道都不误报）', async () => {
    const { store, blind, family } = await setup()
    const now = Date.now()
    store.updateUser(family.id, { apnsToken: 'g'.repeat(64) })
    store.createSafetyTimer({ id: 'stNoMed', ownerId: blind.id, startedAt: now - 30 * 60_000, dueAt: now - 1000, status: 'active' })
    const capPush = new CapturingPush()
    fireExpiredSafetyTimers(store, capPush, webPush, now, GRACE)
    expect(missed(store, family.id)[0].data?.hasMedical).toBeUndefined()
    expect(capPush.alerts[0]?.extra?.hasMedical).toBeUndefined()
  })

  it('安全攸关：医疗信息读抛错（SQLITE_BUSY 等）不吞掉未报到告警——非必需读绝不阻断 dead-man\'s-switch 扇出', async () => {
    // timer 在扇出前已 markFired（免反复扫）+ 后台 tick 无客户端重试：若 getMedicalInfo 同步抛未被隔离，
    // 外层 try 吞掉后整条未报到告警被跳过、亲友**永远收不到**，且 timer 已 fired 不再重扫——告警永久丢失。
    class ThrowingMedicalStore extends MemoryStore {
      getMedicalInfo(_userId: string): undefined { throw new Error('SQLITE_BUSY: database is locked') }
    }
    const { store, blind, family } = await setup(new ThrowingMedicalStore())
    const now = Date.now()
    store.updateUser(family.id, { apnsToken: 'h'.repeat(64) })
    store.createSafetyTimer({ id: 'stThrow', ownerId: blind.id, note: '走夜路', startedAt: now - 30 * 60_000, dueAt: now - 1000, status: 'active' })
    const capPush = new CapturingPush()
    expect(fireExpiredSafetyTimers(store, capPush, webPush, now, GRACE)).toBe(1) // timer 照 fire，未因医疗读抛错被吞
    // 关键：亲友仍收到未报到告警（扇出完整），只是退化为不带 hasMedical。
    const alerts = missed(store, family.id)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].data?.hasMedical).toBeUndefined()
    expect(capPush.alerts.find((a) => a.token === 'h'.repeat(64))).toBeTruthy() // APNs 也确实扇出到了
  })

  it('值守可观测：报到到期告警触达 0 位（有联系人但都无推送）→ emergency_unreachable_total 递增；可达则不增', async () => {
    const { store, blind, family } = await setup()
    const now = Date.now()
    const incs: string[] = []
    const metrics = { inc: (name: string) => { incs.push(name) } }
    // family（accepted∧isEmergency）无 apnsToken、webPush 为 Noop（未配）→ 不可达 → 触达 0。
    store.createSafetyTimer({ id: 'stUnr', ownerId: blind.id, startedAt: now - 30 * 60_000, dueAt: now - 1000, status: 'active' })
    expect(fireExpiredSafetyTimers(store, new CapturingPush(), webPush, now, GRACE, undefined, metrics)).toBe(1)
    expect(incs.filter((n) => n === 'emergency_unreachable_total')).toHaveLength(1) // 触达 0 且有联系人 → 计数
    // dead-man's-switch 到点扇出的告警**无条件**计入 emergency_alerts_total（与 SOS 首呼同口径）——否则"未触达率"
    // (unreachable/alerts) 分母漏 checkin 告警、分子含其失败，率虚高甚至除零（iter384 计数漏账同类）。
    expect(incs.filter((n) => n === 'emergency_alerts_total')).toHaveLength(1)
    // 可达场景：family 有 APNs token → notified≥1 → 不计 unreachable，但**仍计一次 alerts**（告警确实发出了）。
    incs.length = 0
    store.updateUser(family.id, { apnsToken: 'k'.repeat(64) })
    store.createSafetyTimer({ id: 'stReach', ownerId: blind.id, startedAt: now - 30 * 60_000, dueAt: now - 1000, status: 'active' })
    fireExpiredSafetyTimers(store, new CapturingPush(), webPush, now, GRACE, undefined, metrics)
    expect(incs.filter((n) => n === 'emergency_unreachable_total')).toHaveLength(0) // 可达 → 不计
    expect(incs.filter((n) => n === 'emergency_alerts_total')).toHaveLength(1)      // 告警仍计（无条件）
  })

  // 最后已知位置来源 stub（形状同 LiveLocationRegistry.lastKnownForEmergency）。
  const liveStub = (loc?: { lat: number; lng: number; updatedAt: number }) => ({ lastKnownForEmergency: () => loc })

  it('本人在共享位置 → 未报到告警附最后已知位置（emergency_event + 亲友通知 data，locSource=lastKnown）', async () => {
    const { store, blind, family } = await setup()
    const now = Date.now()
    store.createSafetyTimer({ id: 'stLoc', ownerId: blind.id, note: '走夜路', startedAt: now - 30 * 60_000, dueAt: now - 1000, status: 'active' })
    const live = liveStub({ lat: 31.23, lng: 121.47, updatedAt: now - 120_000 }) // 2 分钟前的最后位置
    expect(fireExpiredSafetyTimers(store, push, webPush, now, GRACE, live)).toBe(1)
    // emergency_event 带位置 + 诚实标注
    const ev = store.emergencyEventsForUser(blind.id)[0]
    expect(ev).toMatchObject({ lat: 31.23, lon: 121.47, locSource: 'lastKnown' })
    expect(ev.locAgeSec).toBe(120) // 2 分钟 = 120 秒
    // 亲友通知 data 带 lat/lon（web/iOS 据此渲染"最后已知位置"地图链接，零客户端改动）
    const nd = missed(store, family.id)[0].data!
    expect(nd.lat).toBe('31.23')
    expect(nd.lon).toBe('121.47')
    expect(nd.locSource).toBe('lastKnown')
  })

  it('本人未共享位置（live 无兜底）→ locSource=none、不附坐标（诚实：不谎称有位置）', async () => {
    const { store, blind, family } = await setup()
    const now = Date.now()
    store.createSafetyTimer({ id: 'stNoLoc', ownerId: blind.id, startedAt: now - 30 * 60_000, dueAt: now - 1000, status: 'active' })
    // 传 live 但无最后位置（未共享/已过时）→ 与不传 live 一致：无坐标。
    expect(fireExpiredSafetyTimers(store, push, webPush, now, GRACE, liveStub(undefined))).toBe(1)
    const ev = store.emergencyEventsForUser(blind.id)[0]
    expect(ev.locSource).toBe('none')
    expect(ev.lat).toBeUndefined()
    expect(missed(store, family.id)[0].data?.lat).toBeUndefined()
  })

  it('最后位置坐标非有限（坏 GPS 帧）→ 当作无位置（不把 NaN 附给亲友）', async () => {
    const { store, blind } = await setup()
    const now = Date.now()
    store.createSafetyTimer({ id: 'stBadLoc', ownerId: blind.id, startedAt: now - 30 * 60_000, dueAt: now - 1000, status: 'active' })
    expect(fireExpiredSafetyTimers(store, push, webPush, now, GRACE, liveStub({ lat: NaN, lng: 121, updatedAt: now }))).toBe(1)
    expect(store.emergencyEventsForUser(blind.id)[0].locSource).toBe('none')
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

describe('安全报到到期前提醒本人（remindDueSoonSafetyTimers）', () => {
  const push = new NoopPushSender()
  const webPush = new NoopWebPushSender()
  const LEAD = 10 * 60_000 // 提前 10 分钟

  it('进入提前窗口 → 只提醒本人一次；不惊动亲友；再扫幂等（remindedAt 已置）', async () => {
    const { store, blind, family } = await setup()
    const now = Date.now()
    // 60 分钟计时器，现在处于到期前 8 分钟（在 10 分钟提前窗口内）。
    store.createSafetyTimer({ id: 'r1', ownerId: blind.id, note: '走夜路', startedAt: now - 52 * 60_000, dueAt: now + 8 * 60_000, status: 'active' })
    expect(remindDueSoonSafetyTimers(store, push, webPush, now, LEAD)).toBe(1)
    expect(reminders(store, blind.id)).toHaveLength(1)
    expect(reminders(store, blind.id)[0].body).toContain('8 分钟') // 剩余约 8 分钟
    expect(reminders(store, blind.id)[0].body).toContain('走夜路') // 带备注
    expect(reminders(store, family.id)).toHaveLength(0)            // 亲友绝不收到提醒（这是善意提示非告警）
    expect(store.getSafetyTimer('r1')!.remindedAt).toBe(now)       // 置 remindedAt
    expect(store.getSafetyTimer('r1')!.status).toBe('active')      // 仍 active（提醒不改状态）
    // 幂等：下一 tick 不重复提醒
    expect(remindDueSoonSafetyTimers(store, push, webPush, now + 60_000, LEAD)).toBe(0)
    expect(reminders(store, blind.id)).toHaveLength(1)
  })

  it('窗口外不提醒：离到期还早（now < dueAt-lead）', async () => {
    const { store, blind } = await setup()
    const now = Date.now()
    store.createSafetyTimer({ id: 'r2', ownerId: blind.id, startedAt: now, dueAt: now + 60 * 60_000, status: 'active' }) // 到期还有 60 分钟
    expect(remindDueSoonSafetyTimers(store, push, webPush, now, LEAD)).toBe(0)
  })

  it('短计时器不提前提醒：总时长 ≤ 提前量（用户正盯着，提醒纯噪声）', async () => {
    const { store, blind } = await setup()
    const now = Date.now()
    // 5 分钟计时器 < 10 分钟提前量 → 创建即在"窗口内"，但按设计不提醒。
    store.createSafetyTimer({ id: 'r3', ownerId: blind.id, startedAt: now, dueAt: now + 5 * 60_000, status: 'active' })
    expect(remindDueSoonSafetyTimers(store, push, webPush, now + 60_000, LEAD)).toBe(0)
    expect(reminders(store, blind.id)).toHaveLength(0)
  })

  it('已到期不走提醒（交由到期告警）：now ≥ dueAt', async () => {
    const { store, blind } = await setup()
    const now = Date.now()
    store.createSafetyTimer({ id: 'r4', ownerId: blind.id, startedAt: now - 60 * 60_000, dueAt: now - 1000, status: 'active' })
    expect(remindDueSoonSafetyTimers(store, push, webPush, now, LEAD)).toBe(0)
  })

  it('终态计时器不提醒（completed/canceled/fired）', async () => {
    const { store, blind } = await setup()
    const now = Date.now()
    for (const s of ['completed', 'canceled', 'fired'] as const)
      store.createSafetyTimer({ id: `rs-${s}`, ownerId: blind.id, startedAt: now - 52 * 60_000, dueAt: now + 8 * 60_000, status: s })
    expect(remindDueSoonSafetyTimers(store, push, webPush, now, LEAD)).toBe(0)
  })

  it('leadMs=0 禁用提醒（返回 0、不置 remindedAt）', async () => {
    const { store, blind } = await setup()
    const now = Date.now()
    store.createSafetyTimer({ id: 'r5', ownerId: blind.id, startedAt: now - 52 * 60_000, dueAt: now + 8 * 60_000, status: 'active' })
    expect(remindDueSoonSafetyTimers(store, push, webPush, now, 0)).toBe(0)
    expect(store.getSafetyTimer('r5')!.remindedAt).toBeUndefined()
  })

  it('延长(/extend)清 remindedAt → 对新到期重新提醒一次', async () => {
    const { app, store, blind } = await setup()
    const now = Date.now()
    // 已提醒过的计时器，快到期（+3 分钟）
    store.createSafetyTimer({ id: 'r6', ownerId: blind.id, startedAt: now - 57 * 60_000, dueAt: now + 3 * 60_000, status: 'active', remindedAt: now - 60_000 })
    // 用户延长 30 分钟 → dueAt 推后、remindedAt 应清空
    const ext = await app.inject({ method: 'POST', url: '/api/safety/checkin/extend', headers: blind.h, payload: { addMinutes: 30 } })
    expect(ext.statusCode).toBe(200)
    expect(store.getSafetyTimer('r6')!.remindedAt).toBeUndefined() // 已清空
    // 新到期约 now+33min；快到该新到期时（新窗口内）再次提醒一次。
    const near = now + 24 * 60_000 // 距新到期 ~9 分钟，进入 10 分钟窗口
    expect(remindDueSoonSafetyTimers(store, push, webPush, near, LEAD)).toBe(1)
    expect(reminders(store, blind.id)).toHaveLength(1)
    await app.close()
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

      // dueSoonUnreminded：active∧未提醒∧总时长>lead∧进入[dueAt-lead,dueAt)窗口
      const lead = 10 * 60_000
      const base = 5_000_000
      store.createSafetyTimer({ id: 'due1', ownerId: 'u3', startedAt: base, dueAt: base + 60 * 60_000, status: 'active' }) // 60min 计时器
      const inWin = base + 55 * 60_000 // 距到期 5min，在窗口内
      expect(store.dueSoonUnremindedSafetyTimers(inWin, lead).map((t) => t.id)).toEqual(['due1'])
      expect(store.dueSoonUnremindedSafetyTimers(base + 40 * 60_000, lead)).toHaveLength(0) // 窗口外（还早）
      // remindedAt round-trip + 已提醒不再入选
      store.updateSafetyTimer('due1', { remindedAt: inWin })
      expect(store.getSafetyTimer('due1')!.remindedAt).toBe(inWin) // 字段持久化往返
      expect(store.dueSoonUnremindedSafetyTimers(inWin, lead)).toHaveLength(0) // 已提醒排除
      // 短计时器（时长≤lead）不入选
      store.createSafetyTimer({ id: 'due2', ownerId: 'u3', startedAt: base, dueAt: base + 5 * 60_000, status: 'active' })
      expect(store.dueSoonUnremindedSafetyTimers(base + 60_000, lead).some((t) => t.id === 'due2')).toBe(false)
      store.deleteSafetyTimersForOwner('u3')

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
