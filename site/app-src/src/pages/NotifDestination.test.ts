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
  it('有人请求你共享位置 / 你请求的人开始共享了 → 位置页（开关/地图都在那里）', () => {
    expect(notifDestination('location_request')).toBe('/locations')
    expect(notifDestination('location_share_started')).toBe('/locations') // 请求回路闭合：对方开始共享 → 去地图看
    expect(notifIconKind('location_share_started')).toBe('pin') // 含 'location' 子串 → 定位图标（非默认铃铛）
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
  it('紧急后续/安心类须区别于 SOS 红闪电：报平安=绿勾、有人响应/已看到=电话；真 SOS 才闪电', () => {
    // 收到这些的亲友不该在通知流里误以为又来一起**新**紧急（红闪电=警报）。
    expect(notifIconKind('emergency_clear')).toBe('check')       // 报平安=最安心，绿勾
    expect(notifIconKind('emergency_responding')).toBe('phone')  // 有人在处理=协调好消息
    expect(notifIconKind('emergency_ack')).toBe('phone')         // 有人已看到
    // 真 SOS 通知（kind 恒为 emergency_alert，fall/crash/manual 只是 data 里的 sub-kind）仍是红闪电——
    // 对比锚点，证明只区分了后续/安心类、没误伤告警本身。
    expect(notifIconKind('emergency_alert')).toBe('flash')
  })
  it('其余类：来电=电话、低电量=电池、群/好友=人形、录制=胶片、无匹配=铃铛', () => {
    expect(notifIconKind('incoming_call')).toBe('phone')
    expect(notifIconKind('contact_low_battery')).toBe('battery')
    expect(notifIconKind('friend_request')).toBe('users')
    expect(notifIconKind('group_added')).toBe('users')
    expect(notifIconKind('group_member_joined')).toBe('users')  // 群成员变动=人形
    expect(notifIconKind('group_member_left')).toBe('users')
    expect(notifIconKind('message_pinned')).toBe('pin')          // 置顶消息=📌（与去处=会话+"置顶"语义一致，非默认铃铛）
    expect(notifIconKind('recording_ready')).toBe('film')
    expect(notifIconKind('some_unknown_kind')).toBe('bell')
  })
  it('安全报到（dead-man\'s switch）→ 盾牌：开始/到期提醒/已超时都是安全攸关状态，须与去处 /family 语义一致，绝不落默认铃铛', () => {
    // 回归：safety_checkin_* 曾漏配、落默认铃铛——一个安全打卡的到期状态在通知流里与普通提醒混同、难辨识。
    expect(notifIconKind('safety_checkin_started')).toBe('shield')
    expect(notifIconKind('safety_checkin_reminder')).toBe('shield')
    expect(notifIconKind('safety_checkin_expired')).toBe('shield')
  })
})
