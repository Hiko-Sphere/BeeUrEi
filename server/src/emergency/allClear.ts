import { randomUUID } from 'node:crypto'
import { type Store, isBlockedBetween } from '../db/store'
import type { PushSender } from '../push/apns'
import type { WebPushSender } from '../push/webPush'
import { pushLang, pushStrings } from '../push/pushStrings'
import { totalUnreadFor } from '../db/unread'

/// 报平安（all-clear）广播：解除该用户最近一条未解除的紧急事件 + 向其**已接受**亲友广播"我没事了"安心消息。
/// 抽成可复用函数——`/api/emergency/all-clear` 与「安全报到」的 /complete（到期告警发出后本人报平安）共用，
/// 避免两条解除路径逻辑分叉（同 cascade.dissolveGroup 的"共用一条路"原则）。best-effort/故障隔离，同步 store
/// 读均兜底，单亲友/单通道失败绝不中断其余；push 采用即发即忘（不阻塞调用方）。
/// extraData 合并进通知 data：/all-clear 传 {alertId}（客户端消对应告警模态）；/complete 传 {eventId}。
export function broadcastAllClear(
  store: Store, push: PushSender, webPush: WebPushSender, userId: string, now: number,
  extraData: Record<string, string> = {},
): { resolved: boolean; notified: number } {
  // 治理可观测：标记该用户**全部**未解除事件为已解除（admin 据此区分"已报平安/误报"与"可能仍在进行"）。
  // 解除全部而非仅最近一条——否则同时多条未决时，遗留的旧事件会被升级重呼在本人已报平安后二次误报。best-effort。
  let resolved = false
  try { resolved = store.resolveOpenEmergencyEvents(userId, now) > 0 } catch { /* 解除标记失败不影响广播 */ }
  const me = store.findById(userId)
  if (!me) return { resolved, notified: 0 }
  const safeSubs = (uid: string) => { try { return store.webPushSubscriptionsForUser(uid) } catch { return [] } }
  const safeBadge = (uid: string): number | undefined => { try { return totalUnreadFor(store, uid).total } catch { return undefined } }
  // 排除被拉黑者：与首呼/未报到/升级三条 SOS 链同口径（用户拍板"完全排除被拉黑联系人"，iter62/79）。报平安虽不
  // 带 GPS/hasMedical，但发给被拉黑者会泄露"盲人刚有过一次遇险事件"的存在位、且与"他们从未收到该告警"不一致
  // ——被为安全而拉黑之人(DV/跟踪场景要切断者)不该获知本人的遇险状态。这是 SOS 扇出的**第四条链**(报平安)。
  const members = store.linksByOwner(userId)
    .filter((l) => (l.status ?? 'accepted') === 'accepted' && !isBlockedBetween(store, userId, l.memberId))
    .map((l) => store.findById(l.memberId))
    .filter((m): m is NonNullable<typeof m> => !!m)
  // kind='emergency_clear'：客户端据此区别于告警——绝不触发响铃/大模态，只作普通通知 + 消掉对应告警模态。
  const data: Record<string, string> = { kind: 'emergency_clear', fromId: me.id, fromName: me.displayName, ...extraData }
  for (const m of members) {
    const l = pushLang(m.language)
    const title = pushStrings.emergencyClearTitle(me.displayName, l)
    const body = pushStrings.emergencyClearBody(me.displayName, l)
    try { store.createNotification({ id: randomUUID(), userId: m.id, kind: 'emergency_clear', title, body, data, createdAt: now }) } catch { /* 通知失败不阻断广播 */ }
    // badge=该亲友未读总数（含刚写入的报平安本条），APNs+Web Push 同带（后者供 SW 置 PWA 图标角标）；一次算、两渠道复用。
    const badge = safeBadge(m.id)
    if (webPush.configured) for (const sub of safeSubs(m.id)) void webPush.send(sub, JSON.stringify({ title, body, badge, data })).catch(() => { /* 单订阅失败不阻断 */ })
    if (m.apnsToken) void push.sendAlert(m.apnsToken, title, body, { type: 'emergency_clear', fromId: me.id }, undefined, badge).catch(() => { /* 单点失败不阻断 */ })
  }
  return { resolved, notified: members.length }
}
