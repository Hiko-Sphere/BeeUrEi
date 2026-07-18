import { type Store, isBlockedBetween } from '../db/store'

/// 应急「即时推送可触达」判定——**单点定义**，供 emergency 就绪自检、admin 用户详情、admin 预防性观测三处
/// 复用，避免口径漂移。语义 = SOS/摔倒/未报到告警扇出时的 hasRealtimePush：有 APNs token，或（Web 推送已
/// 配置 VAPID **且**该用户有活订阅）。**必须**门控 webPushConfigured：没配 VAPID 时即便库里存了订阅也发不出，
/// 把这类订阅当"可触达"会高估触达面——对安全网观测就是假安心（admin 旧 hasPush 曾漏此门，遇未配 VAPID 会误判
/// web-only 联系人可达）。best-effort：订阅查询异常按不可达（与告警扇出侧同兜底）。
export function isRealtimeReachable(store: Store, webPushConfigured: boolean, uid: string, apnsToken?: string): boolean {
  if (apnsToken) return true
  if (!webPushConfigured) return false
  try { return store.webPushSubscriptionsForUser(uid).length > 0 } catch { return false }
}

export interface BlindSosReadiness {
  /// 全体 accepted 且未与本人互相拉黑的联系人数 = **实际告警扇出面**（SOS/摔倒/未报到扇给全体 accepted，非仅 isEmergency）。
  acceptedTotal: number
  /// 其中此刻能被即时推送触达的人数。为 0 且 acceptedTotal>0 = 有联系人却全都收不到即时告警（安全网悄然失效）。
  acceptedReachable: number
}

/// 一个盲人的应急安全网就绪度（以实际告警扇出面为准）。owner 恒为视障侧（见 store.ts FamilyLink 注释），
/// 故 accepted 联系人 = linksByOwner(blindId) 中 accepted ∧ 未互相拉黑者——与 emergency 路由的 acceptedContactLinks
/// 同口径（拉黑即撤回：被拉黑者不参与告警扇出，其安全网就绪也不能把他算进可达）。
export function blindSosReadiness(store: Store, webPushConfigured: boolean, blindId: string): BlindSosReadiness {
  const accepted = store.linksByOwner(blindId).filter(
    (l) => (l.status ?? 'accepted') === 'accepted' && !isBlockedBetween(store, blindId, l.memberId),
  )
  let reachable = 0
  for (const l of accepted) {
    const m = store.findById(l.memberId)
    if (m && isRealtimeReachable(store, webPushConfigured, m.id, m.apnsToken)) reachable++
  }
  return { acceptedTotal: accepted.length, acceptedReachable: reachable }
}
