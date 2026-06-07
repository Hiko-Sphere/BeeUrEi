import type { FamilyLink } from '../db/store'

/// 紧急呼叫路由（纯逻辑，可单测，见 PLAN §14.2）：
/// 紧急联系人优先，其次按添加时间（早者优先）。未来可叠加在线状态。
export function planEmergencyRoute(links: FamilyLink[]): FamilyLink[] {
  return [...links].sort((a, b) => {
    if (a.isEmergency !== b.isEmergency) return a.isEmergency ? -1 : 1
    return a.createdAt - b.createdAt
  })
}
