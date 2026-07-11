import { describe, it, expect } from 'vitest'
import { notifDestination, notifIconKind } from './Notifications'

describe('notifDestination 通知点击跳转目的地', () => {
  it('好友/亲友请求 → 亲友页（去接受）', () => {
    expect(notifDestination('friend_request')).toBe('/family')
    expect(notifDestination('friend_accepted')).toBe('/family')
  })
  it('群成员变更 → 聊天页（无 data 兜底列表）', () => {
    expect(notifDestination('group_added')).toBe('/chat')
    expect(notifDestination('group_removed')).toBe('/chat')
    expect(notifDestination('group_dissolved')).toBe('/chat')
  })
  it('会话类通知带 data → 直达对应会话（群深链 /chat/g/:id、单聊 /chat/:peerId）', () => {
    // 群成员变动/改名/加入/离开：有 groupId → 直达该群（iter123 群深链路由）。
    expect(notifDestination('group_member_joined', { groupId: 'g1' })).toBe('/chat/g/g1')
    expect(notifDestination('group_member_left', { groupId: 'g2' })).toBe('/chat/g/g2')
    expect(notifDestination('group_renamed', { groupId: 'g3' })).toBe('/chat/g/g3')
    // 置顶通知：群 → 群深链；单聊 → 对端会话；此前 message_pinned 无去处(null)、点了没反应。
    expect(notifDestination('message_pinned', { groupId: 'g5' })).toBe('/chat/g/g5')
    expect(notifDestination('message_pinned', { fromId: 'p3' })).toBe('/chat/p3')
    expect(notifDestination('message_pinned')).toBe('/chat')   // 无 data 兜底（至少可点开列表，不再是死通知）
    // 群 id 需 URL 编码（防特殊字符破链）。
    expect(notifDestination('group_added', { groupId: 'a/b' })).toBe('/chat/g/a%2Fb')
    // 例外：被移出/群解散——你已进不去那个群，即便带 groupId 也不深链，落聊天列表（否则点了进 403/空群）。
    expect(notifDestination('group_removed', { groupId: 'g1' })).toBe('/chat')
    expect(notifDestination('group_dissolved', { groupId: 'g1' })).toBe('/chat')
  })
  it('路线通知 → 路线库页（原断言 null 的前提"web 无路线页"已过时——/routes 库+预览页已建成）', () => {
    expect(notifDestination('route_added')).toBe('/routes')
  })
  it('到达/离开围栏、共享者低电量 → 位置页（去地图看对方在哪）', () => {
    expect(notifDestination('place_arrival')).toBe('/locations')
    expect(notifDestination('place_departure')).toBe('/locations') // 离开围栏与到达对等
    expect(notifDestination('contact_low_battery')).toBe('/locations')
  })
  it('有人请求你共享位置 → 位置页（开始共享的开关在那里）', () => {
    expect(notifDestination('location_request')).toBe('/locations')
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
  it('安全报到提醒/超时 → 亲友页（SafetyCheckInCard 就在那里：报平安/延长/重开；此前落 null 点了没去处）', () => {
    expect(notifDestination('safety_checkin_reminder')).toBe('/family')
    expect(notifDestination('safety_checkin_expired')).toBe('/family')
  })
  it('无明确去处 → null（仅标已读，不跳转）', () => {
    expect(notifDestination('emergency_alert')).toBeNull() // 紧急有专属"查看位置/回拨"按钮，不整行跳转
    expect(notifDestination('report_resolved')).toBeNull()
  })
})

describe('notifIconKind 通知图标选择（图标须与去处语义一致）', () => {
  it('位置类 → 定位图标：location_request（去处 /locations）与 place_arrival/route 同款，绝不落默认铃铛', () => {
    // 回归：location_request 曾漏配、落到默认铃铛 'bell'，与其 /locations 去处 + RequestShareList 定位图标不一致。
    expect(notifIconKind('location_request')).toBe('pin')
    expect(notifIconKind('place_arrival')).toBe('pin')
    expect(notifIconKind('route_added')).toBe('pin')
  })
  it('顺序敏感分支不被误配：emergency_contact_set=人形(非闪电)、security_*=盾牌(非人形)', () => {
    // emergency_contact 含子串 "emergency" 却须先判为关系事件（人形），不得误成 SOS 告警闪电。
    expect(notifIconKind('emergency_contact_set')).toBe('users')
    expect(notifIconKind('emergency_alert')).toBe('flash')
    // security_apple_linked 含子串 "link"，须先判为账号安全（盾牌），不得被 friend/link 误配成人形。
    expect(notifIconKind('security_apple_linked')).toBe('shield')
    expect(notifIconKind('kyc_verified')).toBe('shield')
    expect(notifIconKind('medical_info_viewed')).toBe('shield')
  })
  it('其余类：来电=电话、低电量=电池、群/好友=人形、录制=胶片、无匹配=铃铛', () => {
    expect(notifIconKind('incoming_call')).toBe('phone')
    expect(notifIconKind('contact_low_battery')).toBe('battery')
    expect(notifIconKind('friend_request')).toBe('users')
    expect(notifIconKind('group_added')).toBe('users')
    expect(notifIconKind('recording_ready')).toBe('film')
    expect(notifIconKind('some_unknown_kind')).toBe('bell')
  })
})
