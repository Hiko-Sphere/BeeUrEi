import { describe, it, expect } from 'vitest'
import { pickUnreadEmergencies, clearedSenderIds, ackEventNotifIds, respondingEventIds } from './emergencyAlerts'
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

  it('同一 eventId 的首呼+升级重呼合并为一条（取最新/升级版）；无 eventId 不合并', () => {
    const list = [
      notif('orig', 'emergency_alert', 100, undefined, { fromId: 'x', eventId: 'e1' }),                 // 首呼
      notif('esc', 'emergency_alert', 200, undefined, { fromId: 'x', eventId: 'e1', escalated: '1' }),  // 升级重呼（更新）
      notif('other', 'emergency_alert', 150, undefined, { fromId: 'y', eventId: 'e2' }),                // 另一次事件
      notif('noev', 'emergency_alert', 120),                                                            // 无 eventId：不合并
    ]
    const picked = pickUnreadEmergencies(list, none)
    expect(picked.map((n) => n.id)).toEqual(['esc', 'other', 'noev']) // e1 只留最新 esc；e2 留；无 eventId 留
    expect(picked[0].data?.escalated).toBe('1')                        // 展示的是升级版（措辞更急）
  })

  it('白名单：只有 emergency_alert 弹告警模态；ack/clear/responding 等 emergency_* 反馈协调类都不弹', () => {
    const list = [
      notif('a', 'emergency_alert', 100),      // 真告警：弹
      notif('k', 'emergency_ack', 300),        // 回执：kind 含 emergency 但绝不弹
      notif('c', 'emergency_clear', 400),      // 报平安：反馈类，绝不弹
      notif('r', 'emergency_responding', 350), // 有人在响应：协调类，绝不弹（白名单杜绝误弹）
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

describe('ackEventNotifIds（"知道了"时收敛同一事件的全部告警通知）', () => {
  it('同 eventId 的首呼+升级重呼一起标读——否则被折叠隐藏的兄弟下轮重新弹', () => {
    const list = [
      notif('orig', 'emergency_alert', 100, undefined, { fromId: 'x', eventId: 'e1' }),
      notif('esc', 'emergency_alert', 200, undefined, { fromId: 'x', eventId: 'e1', escalated: '1' }),
      notif('other', 'emergency_alert', 150, undefined, { fromId: 'y', eventId: 'e2' }), // 不同事件：不收
    ]
    // top = 展示的升级版 esc；确认应连带首呼 orig 一起清（都属 e1），但不碰 e2
    const ids = ackEventNotifIds(list, list[1])
    expect([...ids].sort()).toEqual(['esc', 'orig'])
  })

  it('无 eventId 的老通知只收敛自身（向后兼容）', () => {
    const top = notif('solo', 'emergency_alert', 100)
    expect(ackEventNotifIds([top, notif('n2', 'emergency_alert', 90)], top)).toEqual(['solo'])
  })

  it('反馈类(ack/clear)不被裹入；top 自身始终包含（即便不在列表里）', () => {
    const top = notif('esc', 'emergency_alert', 200, undefined, { eventId: 'e1' })
    const list = [
      notif('orig', 'emergency_alert', 100, undefined, { eventId: 'e1' }),
      notif('ackn', 'emergency_ack', 150, undefined, { eventId: 'e1' }),   // 回执：不裹
      notif('clr', 'emergency_clear', 160, undefined, { eventId: 'e1' }),  // 报平安：不裹
    ] // 注意 top(esc) 不在 list 里
    expect([...ackEventNotifIds(list, top)].sort()).toEqual(['esc', 'orig'])
  })

  // 端到端回归（在逻辑层复现 host 两轮轮询）：确认升级告警后，被折叠隐藏的首呼不该在下一轮重新弹。
  // 修复前 host 只标 top(esc) 一条 → 下轮 orig 仍未读被重新拾起、重弹+响铃。
  it('回归：确认升级告警后，被折叠的首呼不再于下一轮重新弹出', () => {
    let list = [
      notif('orig', 'emergency_alert', 100, undefined, { fromId: 'x', eventId: 'e1' }),
      notif('esc', 'emergency_alert', 200, undefined, { fromId: 'x', eventId: 'e1', escalated: '1' }),
    ]
    const dismissed = new Set<string>()
    const round1 = pickUnreadEmergencies(list, dismissed)
    expect(round1.map((n) => n.id)).toEqual(['esc'])            // 第一轮：折叠后只展示升级版
    const acked = ackEventNotifIds(list, round1[0])            // "知道了"：收敛同事件全部 id
    acked.forEach((id) => dismissed.add(id))
    list = list.map((n) => (acked.includes(n.id) ? { ...n, readAt: 300 } as NotificationInfo : n)) // 服务端标读
    expect(pickUnreadEmergencies(list, dismissed)).toEqual([]) // 第二轮：首呼不再弹（修复前会返回 ['orig']）
  })
})

describe('respondingEventIds（已有其他亲友在响应的事件）', () => {
  it('收集 emergency_responding 通知的 eventId；其它 kind 不计', () => {
    const list = [
      notif('a', 'emergency_alert', 100, undefined, { eventId: 'e1' }),
      notif('r', 'emergency_responding', 150, undefined, { eventId: 'e1', fromId: 'x' }), // 有人在响应 e1
      notif('k', 'emergency_ack', 160, undefined, { eventId: 'e1' }),                     // 回执：不计
      notif('r2', 'emergency_responding', 170, undefined, { eventId: 'e2' }),             // 另一事件
    ]
    const s = respondingEventIds(list)
    expect(s.has('e1')).toBe(true)
    expect(s.has('e2')).toBe(true)
    expect(s.size).toBe(2)
  })
  it('无 eventId 的 responding 通知被忽略（无从关联）', () => {
    expect(respondingEventIds([notif('r', 'emergency_responding', 100)]).size).toBe(0)
  })
})
