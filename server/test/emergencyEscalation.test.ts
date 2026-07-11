import { describe, it, expect } from 'vitest'
import { MemoryStore } from '../src/db/store'
import { NoopWebPushSender, type WebPushSender, type WebPushSubscriptionKeys } from '../src/push/webPush'
import { escalateUnackedEmergencies } from '../src/emergency/escalation'
import type { PushSender } from '../src/push/apns'

class FakePush implements PushSender {
  alerts: { token: string; extra?: Record<string, string> }[] = []
  async send(): Promise<void> {}
  async sendCallInvite(): Promise<void> {}
  async sendAlert(token: string, _t: string, _b: string, extra?: Record<string, string>): Promise<void> {
    this.alerts.push({ token, extra })
  }
}

/// 记录式 web 推送替身：记下每次 send 的负载，用于断言升级重呼的 web push 顶层带 badge。
class RecordingWebPush implements WebPushSender {
  readonly configured = true
  sent: string[] = []
  async send(_sub: WebPushSubscriptionKeys, payload: string): Promise<'sent'> { this.sent.push(payload); return 'sent' }
}

const MIN = 60_000
const user = (id: string, apnsToken?: string) =>
  ({ id, username: id, passwordHash: 'h', displayName: id, role: 'blind', status: 'active', createdAt: 1, apnsToken } as any)

function setup() {
  const store = new MemoryStore()
  store.createUser(user('victim'))
  store.createUser(user('famA', 'a'.repeat(64)))  // 有 APNs token
  store.createUser(user('famB', 'b'.repeat(64)))
  store.createLink({ id: 'l1', ownerId: 'victim', memberId: 'famA', relation: '亲友', isEmergency: true, status: 'accepted', createdAt: 1 } as any)
  store.createLink({ id: 'l2', ownerId: 'victim', memberId: 'famB', relation: '亲友', isEmergency: true, status: 'accepted', createdAt: 1 } as any)
  return { store, push: new FakePush(), web: new NoopWebPushSender() }
}
const evt = (over: Record<string, unknown> = {}) =>
  ({ id: 'e1', userId: 'victim', kind: 'fall', notified: 2, contacts: 2, at: 0, ...over } as any)

describe('紧急升级重呼 escalateUnackedEmergencies', () => {
  it('无人确认满阈值 → 升级重呼全部亲友、标 escalatedAt、且至多一次', () => {
    const now = 100 * MIN
    const { store, push, web } = setup()
    store.createEmergencyEvent(evt({ at: now - 6 * MIN, lat: 39.9, lon: 116.4, locSource: 'live' }))

    expect(escalateUnackedEmergencies(store, push, web, now, 5 * MIN)).toBe(1)
    expect(push.alerts.map((a) => a.extra?.escalated)).toEqual(['1', '1']) // 两位亲友都收到升级告警
    expect(push.alerts[0].extra?.lat).toBe('39.9')                          // 带存库的位置
    expect(push.alerts[0].extra?.locSource).toBe('live')                    // APNs extra 也带 locSource（诚实标注实时/最后已知）
    // 持久化 emergency_alert 通知含 escalated 标记 + locSource（通知中心兜底，与 APNs 跨渠道一致）。
    const escNotif = store.notificationsForUser('famA').filter((x: any) => x.kind === 'emergency_alert' && x.data?.escalated === '1')
    expect(escNotif).toHaveLength(1)
    expect(escNotif[0].data?.locSource).toBe('live')
    expect(store.emergencyEventsForUser('victim')[0].escalatedAt).toBe(now)

    // 再扫不重复升级（escalatedAt 已设）。
    expect(escalateUnackedEmergencies(store, push, web, now + MIN, 5 * MIN)).toBe(0)
    expect(push.alerts).toHaveLength(2)
  })

  it('升级重呼 → 亲友 web push 顶层带 badge（含刚写入的升级通知）→ SW 可置 PWA 图标角标', () => {
    const now = 100 * MIN
    const { store, push } = setup()
    const web = new RecordingWebPush()
    store.upsertWebPushSubscription({ endpoint: 'https://push.example/famA', userId: 'famA', p256dh: 'k', auth: 'a', createdAt: 1 })
    store.createEmergencyEvent(evt({ at: now - 6 * MIN }))
    expect(escalateUnackedEmergencies(store, push, web, now, 5 * MIN)).toBe(1)
    expect(web.sent.length).toBeGreaterThanOrEqual(1)
    const payload = JSON.parse(web.sent[0])
    expect(typeof payload.badge).toBe('number')       // APNs 一直带 badge，此前 web 漏——顶层带上供 SW 置角标
    expect(payload.badge).toBeGreaterThanOrEqual(1)    // 升级重呼给 famA 写了一条 emergency_alert 通知（未读≥1）
    expect(payload.data.escalated).toBe('1')
  })

  it('发起人有紧急医疗信息 → 升级告警带 hasMedical（漏看首呼者也知有过敏/用药可查）', () => {
    const now = 100 * MIN
    const { store, push, web } = setup()
    store.setMedicalInfo({ userId: 'victim', sealed: 'sealed-blob', updatedAt: 1 }) // 仅需存在（escalation 只查 hasMedical 与否）
    store.createEmergencyEvent(evt({ at: now - 6 * MIN }))
    expect(escalateUnackedEmergencies(store, push, web, now, 5 * MIN)).toBe(1)
    expect(push.alerts[0].extra?.hasMedical).toBe('1')            // APNs extra 带
    const notif = store.notificationsForUser('famA').find((x: any) => x.kind === 'emergency_alert')
    expect(notif?.data?.hasMedical).toBe('1')                     // 持久化通知 data 也带
  })

  it('发起人无医疗信息 → 升级告警不带 hasMedical（不误报有信息可查）', () => {
    const now = 100 * MIN
    const { store, push, web } = setup()
    store.createEmergencyEvent(evt({ at: now - 6 * MIN }))
    escalateUnackedEmergencies(store, push, web, now, 5 * MIN)
    expect(push.alerts[0].extra?.hasMedical).toBeUndefined()
    const notif = store.notificationsForUser('famA').find((x: any) => x.kind === 'emergency_alert')
    expect(notif?.data?.hasMedical).toBeUndefined()
  })

  it('安全攸关：医疗信息读抛错（SQLITE_BUSY 等）不吞掉升级重呼——非必需读绝不阻断最后一层兜底扇出', () => {
    // 事件已 markEscalated（免反复扫）+ 后台 tick 无重试：若 getMedicalInfo 同步抛未被隔离，外层 try 吞掉后
    // 整条升级重呼被跳过、漏看首呼的亲友**永远收不到**，且已 escalated 不再重扫——最后一层兜底永久丢失。
    class ThrowingMedicalStore extends MemoryStore {
      getMedicalInfo(_userId: string): undefined { throw new Error('SQLITE_BUSY: database is locked') }
    }
    const now = 100 * MIN
    const store = new ThrowingMedicalStore()
    store.createUser(user('victim'))
    store.createUser(user('famA', 'a'.repeat(64)))
    store.createLink({ id: 'l1', ownerId: 'victim', memberId: 'famA', relation: '亲友', isEmergency: true, status: 'accepted', createdAt: 1 } as any)
    const push = new FakePush(); const web = new NoopWebPushSender()
    store.createEmergencyEvent(evt({ at: now - 6 * MIN }))
    expect(escalateUnackedEmergencies(store, push, web, now, 5 * MIN)).toBe(1) // 升级照发，未因医疗读抛错被吞
    expect(push.alerts.find((a) => a.token === 'a'.repeat(64))).toBeTruthy()    // 亲友确实收到升级 APNs
    const notif = store.notificationsForUser('famA').find((x: any) => x.kind === 'emergency_alert')
    expect(notif).toBeTruthy()                       // 持久化升级通知也写了（扇出完整）
    expect(notif?.data?.hasMedical).toBeUndefined()  // 医疗读失败退化为不标，升级本身完好
  })

  it('已有亲友确认(ack) → 不升级（有人在响应）', () => {
    const now = 100 * MIN
    const { store, push, web } = setup()
    store.createEmergencyEvent(evt({ at: now - 6 * MIN }))
    store.markEmergencyAcked('e1', now - 5 * MIN)
    expect(escalateUnackedEmergencies(store, push, web, now, 5 * MIN)).toBe(0)
    expect(push.alerts).toHaveLength(0)
  })

  it('已报平安(resolved)不升级；未满阈值(太近)不升级', () => {
    const now = 100 * MIN
    const { store, push, web } = setup()
    store.createEmergencyEvent(evt({ id: 'eR', at: now - 6 * MIN, resolvedAt: now - 5 * MIN }))
    store.createEmergencyEvent(evt({ id: 'eNew', at: now - 2 * MIN })) // 才 2 分钟，未满 5
    expect(escalateUnackedEmergencies(store, push, web, now, 5 * MIN)).toBe(0)
    expect(push.alerts).toHaveLength(0)
  })
})
