import { describe, it, expect } from 'vitest'
import { notifDestination } from './Notifications'

describe('notifDestination 通知点击跳转目的地', () => {
  it('好友/亲友请求 → 亲友页（去接受）', () => {
    expect(notifDestination('friend_request')).toBe('/family')
    expect(notifDestination('friend_accepted')).toBe('/family')
  })
  it('群成员变更 → 聊天页', () => {
    expect(notifDestination('group_added')).toBe('/chat')
    expect(notifDestination('group_removed')).toBe('/chat')
    expect(notifDestination('group_dissolved')).toBe('/chat')
  })
  it('无明确去处 → null（仅标已读，不跳转）', () => {
    expect(notifDestination('emergency_alert')).toBeNull() // 紧急有专属"查看位置/回拨"按钮，不整行跳转
    expect(notifDestination('report_resolved')).toBeNull()
    expect(notifDestination('kyc_verified')).toBeNull()
    expect(notifDestination('route_added')).toBeNull() // 路线执行在 iOS，web 无路线执行页
  })
})
