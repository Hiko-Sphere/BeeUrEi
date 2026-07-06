import { describe, it, expect } from 'vitest'
import { notifCategory, isCategoryMuted, sanitizeMutedCategories, MUTABLE_CATEGORIES } from '../src/notifications/notifCategories'

describe('通知类别静音（纯逻辑）', () => {
  it('notifCategory：软类别正确归类', () => {
    expect(notifCategory('route_added')).toBe('route')
    expect(notifCategory('route_updated')).toBe('route')
    expect(notifCategory('route_deleted')).toBe('route')
    expect(notifCategory('place_arrival')).toBe('location')
    expect(notifCategory('place_departure')).toBe('location')
    expect(notifCategory('battery_low')).toBe('location')
    expect(notifCategory('friend_request')).toBe('social')
    expect(notifCategory('friend_accepted')).toBe('social')
    expect(notifCategory('group_added')).toBe('social')
    expect(notifCategory('group_removed')).toBe('social')
  })

  it('安全不变量：危急类（紧急/安全/来电/报到）永不可静音 → null', () => {
    // 即便文本里含 route/place/friend/group 子串，isAlwaysThrough 先判也会兜住 → null（纵深防御）。
    expect(notifCategory('emergency_alert')).toBeNull()
    expect(notifCategory('emergency_contact_set')).toBeNull() // 关系事件但含 emergency → 不可静音
    expect(notifCategory('security_new_device')).toBeNull()
    expect(notifCategory('security_password_changed')).toBeNull()
    expect(notifCategory('incoming_call')).toBeNull()
    expect(notifCategory('call_missed')).toBeNull()
    expect(notifCategory('safety_checkin_expired')).toBeNull()
    // 处置/审核结果类：故意不列入可静音（用户不该错过）→ null
    expect(notifCategory('report_resolved')).toBeNull()
    expect(notifCategory('kyc_verified')).toBeNull()
    expect(notifCategory('medical_info_viewed')).toBeNull()
    expect(notifCategory('chat_message')).toBeNull() // 聊天走独立 DM 静音，不归类别
    // 纵深防御的要害：将来若出现既危急、名字又含 route/place 子串的 kind（如"安全报到含路线提醒"），
    // isAlwaysThrough 先判必须兜住它 → null，绝不能因子串命中被归入可静音的 route/location。
    expect(notifCategory('safety_route_reminder')).toBeNull() // 含 'safety'(危急) + 'route' → 仍 null
    expect(notifCategory('emergency_place_alert')).toBeNull() // 含 'emergency'(危急) + 'place' → 仍 null
  })

  it('isCategoryMuted：命中已静音类别 → true；未静音/空集 → false', () => {
    expect(isCategoryMuted(['route'], 'route_added')).toBe(true)
    expect(isCategoryMuted(['route'], 'place_arrival')).toBe(false) // 静音 route 不影响 location
    expect(isCategoryMuted(['social', 'location'], 'group_added')).toBe(true)
    expect(isCategoryMuted(['social', 'location'], 'place_departure')).toBe(true)
    expect(isCategoryMuted([], 'route_added')).toBe(false)
    expect(isCategoryMuted(undefined, 'route_added')).toBe(false)
  })

  it('isCategoryMuted：危急类即便"静音了对应类别"也绝不静音', () => {
    // 用户不可能把 emergency 归到某类别再静音——notifCategory 恒 null，故恒 false。
    expect(isCategoryMuted(['social', 'route', 'location'], 'emergency_alert')).toBe(false)
    expect(isCategoryMuted(['social', 'route', 'location'], 'security_new_device')).toBe(false)
    expect(isCategoryMuted(['social', 'route', 'location'], 'incoming_call')).toBe(false)
  })

  it('sanitizeMutedCategories：去非法、去重、稳定序', () => {
    expect(sanitizeMutedCategories(['route', 'social'])).toEqual(['social', 'route']) // 稳定序=MUTABLE_CATEGORIES 顺序
    expect(sanitizeMutedCategories(['route', 'route', 'route'])).toEqual(['route'])   // 去重
    expect(sanitizeMutedCategories(['emergency', 'bogus', 'location'])).toEqual(['location']) // 去非法
    expect(sanitizeMutedCategories([])).toEqual([])
    expect(sanitizeMutedCategories([...MUTABLE_CATEGORIES])).toEqual(['social', 'route', 'location'])
  })
})
