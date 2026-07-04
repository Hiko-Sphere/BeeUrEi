import { describe, it, expect } from 'vitest'
import { pickUnreadEmergencies, clearedSenderIds } from './emergencyAlerts'
import type { NotificationInfo } from './api'

function notif(id: string, kind: string, createdAt: number, readAt?: number, data?: Record<string, string>): NotificationInfo {
  return { id, userId: 'me', kind, title: 't', body: 'b', createdAt, readAt: readAt ?? null, data: data ?? null } as unknown as NotificationInfo
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

  it('回执 emergency_ack / 报平安 emergency_clear 都不弹告警模态（反馈类，非新告警）', () => {
    const list = [
      notif('a', 'emergency_alert', 100), // 真告警：弹
      notif('k', 'emergency_ack', 300),   // 回执：kind 含 emergency 但绝不弹
      notif('c', 'emergency_clear', 400), // 报平安：反馈类，绝不弹
    ]
    expect(pickUnreadEmergencies(list, none).map((n) => n.id)).toEqual(['a'])
  })

  it('clearedSenderIds：发起人报平安后，其名下告警不再弹（按 fromId 聚合消掉）', () => {
    const list = [
      notif('a1', 'emergency_alert', 100, undefined, { fromId: 'userX' }),
      notif('a2', 'emergency_alert', 200, undefined, { fromId: 'userY' }),
      notif('c1', 'emergency_clear', 300, undefined, { fromId: 'userX', alertId: 'z1' }), // X 报平安
    ]
    const cleared = clearedSenderIds(list)
    expect(cleared.has('userX')).toBe(true)
    expect(cleared.has('userY')).toBe(false)
    // 应用到告警选择：X 的告警消掉、Y 的保留（EmergencyAlertHost 同款过滤）
    const shown = pickUnreadEmergencies(list, none).filter((n) => !(n.data?.fromId && cleared.has(n.data.fromId)))
    expect(shown.map((n) => n.id)).toEqual(['a2'])
  })
})
