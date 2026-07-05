import { randomUUID } from 'node:crypto'
import type { Store } from '../db/store'
import type { PushSender } from '../push/apns'
import type { WebPushSender } from '../push/webPush'
import { pushLang, pushStrings } from '../push/pushStrings'
import { totalUnreadFor } from '../db/unread'

/// 紧急升级重呼（medical-alert 式 escalation）：告警发出满 thresholdMs 仍**无任何亲友确认(ack)**、
/// **未报平安(all-clear)**、且**未升级过** → 再向全部已接受亲友推一次、措辞更急，争取抓住第一次漏看的人
/// （亲友睡着/静音/漏推的兜底）。**至多升级一次**（先落 escalatedAt 再扇出；宁可漏推、绝不重复轰炸致告警疲劳）。
/// best-effort：单事件/单亲友推送失败绝不中断其余（同 SOS 首呼扇出的故障隔离；同步 store 读均兜底）。返回升级事件数。
export function escalateUnackedEmergencies(
  store: Store, push: PushSender, webPush: WebPushSender, now: number, thresholdMs: number,
): number {
  const stale = store.unacknowledgedEmergencyEvents(now - thresholdMs, now)
  const safeSubs = (uid: string) => { try { return store.webPushSubscriptionsForUser(uid) } catch { return [] } }
  const safeBadge = (uid: string): number | undefined => { try { return totalUnreadFor(store, uid).total } catch { return undefined } }
  let escalated = 0
  for (const e of stale) {
    try {
      store.markEmergencyEscalated(e.id, now) // 先标记：即便下面推送部分失败也不重复升级
      const sender = store.findById(e.userId)
      if (!sender) continue // 发起人已删号：无从重呼（已 markEscalated，免反复扫）
      const members = store.linksByOwner(e.userId)
        .filter((l) => (l.status ?? 'accepted') === 'accepted')
        .map((l) => store.findById(l.memberId))
        .filter((m): m is NonNullable<typeof m> => !!m)
      const hasLoc = e.lat != null && e.lon != null
      // 发起人是否填了紧急医疗信息：与首呼(emergency.ts)/未报到(checkin.ts)同口径带 hasMedical——升级重呼恰是要抓
      // **漏看首呼**的人，他们只见到这条，若不带 hasMedical 就不知有过敏/用药/病史可查（医疗急救刚需，见复审 missed-sibling）。
      const hasMedical = !!store.getMedicalInfo(sender.id)
      const minutes = Math.max(1, Math.round((now - e.at) / 60_000))
      const notifData: Record<string, string> = {
        kind: 'emergency_alert', type: 'emergency_alert', escalated: '1', fromId: sender.id, fromName: sender.displayName, eventId: e.id, alertKind: e.kind,
      }
      if (hasLoc) { notifData.lat = String(e.lat); notifData.lon = String(e.lon); if (e.locSource) notifData.locSource = e.locSource }
      if (hasMedical) notifData.hasMedical = '1'
      for (const m of members) {
        const l = pushLang(m.language)
        const title = pushStrings.emergencyEscalateTitle(sender.displayName, l)
        const body = pushStrings.emergencyEscalateBody(minutes, hasLoc, l)
        // 持久化通知发给每个 accepted 亲友（含无 token 者：通知中心兜底），与首呼同口径。
        try { store.createNotification({ id: randomUUID(), userId: m.id, kind: 'emergency_alert', title, body, data: notifData, createdAt: now }) } catch { /* 通知失败不阻断推送 */ }
        if (webPush.configured) for (const sub of safeSubs(m.id)) void webPush.send(sub, JSON.stringify({ title, body, data: notifData })).catch(() => { /* 单订阅失败不阻断 */ })
        if (m.apnsToken) {
          const extra: Record<string, string> = { type: 'emergency_alert', escalated: '1', kind: e.kind, fromId: sender.id, eventId: e.id }
          if (hasLoc) { extra.lat = String(e.lat); extra.lon = String(e.lon) }
          if (hasMedical) extra.hasMedical = '1'
          void push.sendAlert(m.apnsToken, title, body, extra, undefined, safeBadge(m.id)).catch(() => { /* 单点失败不阻断 */ })
        }
      }
      escalated++
    } catch { /* 单事件升级失败不阻断其余（已 markEscalated 则不再重试同一条） */ }
  }
  return escalated
}
