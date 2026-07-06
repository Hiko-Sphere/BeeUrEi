import type { FamilyLink } from './api'

/// 是否有「可用的紧急联系人」（已接受 ∧ 标为紧急）——SOS/紧急告警/摔倒告警的扇出**只走这类**
/// （服务端 linksByOwner ∧ isEmergency）。无则遇险**无人可自动通知**，属静默的假安心，须在删除最后一位时提醒本人。
/// 与 iOS FamilyLinkInfo.hasUsableEmergencyContact 同口径（已接受 ∧ 紧急），纯逻辑可单测。
/// status 缺省视作 accepted（服务端对本人自有链常不下发 status；与 Family.tsx accepted 过滤同口径）。
export function hasUsableEmergencyContact(links: FamilyLink[]): boolean {
  return links.some((l) => (l.status ?? 'accepted') === 'accepted' && l.isEmergency)
}
