import type { FamilyLink } from '../db/store'

/// 紧急呼叫路由（纯逻辑，可单测，见 PLAN §14.2）：
/// 紧急联系人优先，其次按添加时间（早者优先），同毫秒再按 id——(createdAt,id) 稳定全序。
/// 否则同毫秒添加的两个联系人排序取决于输入序，而 linksByOwner 的输入序在 MemoryStore(插入序)
/// 与 SqliteStore(ORDER BY createdAt DESC)间不一致 → 两部署下紧急呼叫顺序漂移（安全攸关路径应确定）。
export function planEmergencyRoute(links: FamilyLink[]): FamilyLink[] {
  return [...links].sort((a, b) => {
    if (a.isEmergency !== b.isEmergency) return a.isEmergency ? -1 : 1
    return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  })
}
