import type { FamilyLink } from '../db/store'

/// 紧急呼叫路由（纯逻辑，可单测，见 PLAN §14.2）。排序键（从主到次）：
/// ① 紧急联系人优先（尊重用户显式指定的信任层级——遇险不该在配偶/监护人之前先呼叫陌生志愿者）；
/// ② **同一信任层级内，在线者优先**——遇险时先接通此刻真正待命、能立即响应的人，避免在离线联系人上
///    白等振铃、延误救援（isOnline 未提供时此键退化为全等，完全退回原 (isEmergency,createdAt,id) 序）；
/// ③ 添加时间早者优先；④ 同毫秒再按 id——(createdAt,id) 保证稳定全序。
/// 若无 ④，同毫秒添加的两联系人排序取决于输入序，而 linksByOwner 输入序在 MemoryStore(插入序)
/// 与 SqliteStore(ORDER BY createdAt DESC)间不一致 → 两部署下紧急呼叫顺序漂移（安全攸关路径应确定）。
///
/// 注意：在线只在**层级内**当加权项，不跨层级——离线的紧急联系人仍排在在线的非紧急联系人之前。
/// 因为告警推送本就发给所有人（离线联系人会收到响亮推送并很可能应答），而用户把某人标为紧急联系人
/// 的意图应主导呼叫顺序；在线与否只是同层级内"谁更可能立刻接通"的合理加权。
export function planEmergencyRoute(links: FamilyLink[], isOnline?: (memberId: string) => boolean): FamilyLink[] {
  const online = isOnline ?? (() => false) // 无 presence：全部视为同级 → 退回纯 (isEmergency,createdAt,id) 序
  return [...links].sort((a, b) => {
    if (a.isEmergency !== b.isEmergency) return a.isEmergency ? -1 : 1
    const ao = online(a.memberId), bo = online(b.memberId)
    if (ao !== bo) return ao ? -1 : 1
    return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  })
}
