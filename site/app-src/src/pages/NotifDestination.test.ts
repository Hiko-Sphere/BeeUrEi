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
  it('路线通知 → 路线库页（原断言 null 的前提"web 无路线页"已过时——/routes 库+预览页已建成）', () => {
    expect(notifDestination('route_added')).toBe('/routes')
  })
  it('到达/离开围栏、共享者低电量 → 位置页（去地图看对方在哪）', () => {
    expect(notifDestination('place_arrival')).toBe('/locations')
    expect(notifDestination('place_departure')).toBe('/locations') // 离开围栏与到达对等
    expect(notifDestination('contact_low_battery')).toBe('/locations')
  })
  it('实名结果 → 账户页（实名认证区就在 /account）', () => {
    expect(notifDestination('kyc_verified')).toBe('/account')
    expect(notifDestination('kyc_rejected')).toBe('/account')
  })
  it('账号安全变更预警 → 账户页（去改密/重开 2FA）', () => {
    expect(notifDestination('security_password_changed')).toBe('/account')
    expect(notifDestination('security_2fa_disabled')).toBe('/account')
    expect(notifDestination('security_email_changed')).toBe('/account')
  })
  it('医疗信息被查看（访问透明）→ 账户页（管理你的医疗信息）', () => {
    expect(notifDestination('medical_info_viewed')).toBe('/account')
  })
  it('被设为紧急联系人 → 亲友页（关系事件，非 SOS；含子串 emergency 却不得落到 null 与 emergency_alert 混淆）', () => {
    expect(notifDestination('emergency_contact_set')).toBe('/family')
  })
  it('无明确去处 → null（仅标已读，不跳转）', () => {
    expect(notifDestination('emergency_alert')).toBeNull() // 紧急有专属"查看位置/回拨"按钮，不整行跳转
    expect(notifDestination('report_resolved')).toBeNull()
  })
})
