import { describe, it, expect } from 'vitest'
import { MemoryStore } from '../src/db/store'
import { NoopWebPushSender } from '../src/push/webPush'
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
    // 持久化 emergency_alert 通知含 escalated 标记（通知中心兜底）。
    expect(store.notificationsForUser('famA').filter((x: any) => x.kind === 'emergency_alert' && x.data?.escalated === '1')).toHaveLength(1)
    expect(store.emergencyEventsForUser('victim')[0].escalatedAt).toBe(now)

    // 再扫不重复升级（escalatedAt 已设）。
    expect(escalateUnackedEmergencies(store, push, web, now + MIN, 5 * MIN)).toBe(0)
    expect(push.alerts).toHaveLength(2)
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
