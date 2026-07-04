import { describe, it, expect } from 'vitest'
import { pickUnreadEmergencies } from './emergencyAlerts'
import type { NotificationInfo } from './api'

function notif(id: string, kind: string, createdAt: number, readAt?: number): NotificationInfo {
  return { id, userId: 'me', kind, title: 't', body: 'b', createdAt, readAt: readAt ?? null } as unknown as NotificationInfo
}

describe('pickUnreadEmergencies（告警实时弹出的挑选规则）', () => {
  const none = new Set<string>()

  it('只取未读紧急告警，按时间倒序（最新在前）', () => {
    const list = [
      notif('a', 'emergency_alert', 100),
      notif('b', 'friend_request', 200),      // 非紧急：不弹
      notif('c', 'emergency_alert', 300),
      notif('d', 'emergency_alert', 200, 250), // 已读：不弹
    ]
    expect(pickUnreadEmergencies(list, none).map((n) => n.id)).toEqual(['c', 'a'])
  })

  it('会话内"稍后"过的不再弹（但不影响其它告警）', () => {
    const list = [notif('a', 'emergency_alert', 100), notif('b', 'emergency_alert', 200)]
    expect(pickUnreadEmergencies(list, new Set(['b'])).map((n) => n.id)).toEqual(['a'])
  })

  it('空列表/全已读 → 空（不弹）', () => {
    expect(pickUnreadEmergencies([], none)).toEqual([])
    expect(pickUnreadEmergencies([notif('a', 'emergency_alert', 100, 150)], none)).toEqual([])
  })

  it('回执 emergency_ack 不弹告警模态（"X 已看到你的求助"是给发起人的反馈，非新告警）', () => {
    const list = [
      notif('a', 'emergency_alert', 100), // 真告警：弹
      notif('k', 'emergency_ack', 300),   // 回执：kind 含 emergency 但绝不弹响铃大模态
    ]
    expect(pickUnreadEmergencies(list, none).map((n) => n.id)).toEqual(['a'])
  })
})
