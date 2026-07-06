import { describe, it, expect } from 'vitest'
import { hasUsableEmergencyContact } from './emergencyContacts'
import type { FamilyLink } from './api'

const mk = (over: Partial<FamilyLink>): FamilyLink => ({
  id: 'l', memberId: 'm', memberName: 'X', relation: '亲友', isEmergency: false, ...over,
})

describe('hasUsableEmergencyContact（已接受∧紧急才算可通知；与 iOS 同口径）', () => {
  it('已接受 + 紧急 → 有可用紧急联系人（SOS/摔倒扇出只走这类）', () => {
    expect(hasUsableEmergencyContact([mk({ isEmergency: true, status: 'accepted' })])).toBe(true)
  })
  it('缺 status（默认视作已接受）+ 紧急 → 有', () => {
    expect(hasUsableEmergencyContact([mk({ isEmergency: true })])).toBe(true)
  })
  it('已接受但非紧急 → 无（非紧急联系人不进 SOS 扇出）', () => {
    expect(hasUsableEmergencyContact([mk({ isEmergency: false, status: 'accepted' })])).toBe(false)
  })
  it('紧急但未接受(pending) → 无（服务端只对 accepted 扇出，pending 收不到）', () => {
    expect(hasUsableEmergencyContact([mk({ isEmergency: true, status: 'pending' })])).toBe(false)
  })
  it('空列表 → 无', () => {
    expect(hasUsableEmergencyContact([])).toBe(false)
  })
  it('混合里有一个已接受+紧急 → 有', () => {
    expect(hasUsableEmergencyContact([
      mk({ id: 'a', isEmergency: false, status: 'accepted' }),
      mk({ id: 'b', isEmergency: true, status: 'pending' }),
      mk({ id: 'c', isEmergency: true, status: 'accepted' }),
    ])).toBe(true)
  })
})
