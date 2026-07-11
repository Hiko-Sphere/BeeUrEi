import { randomUUID } from 'node:crypto'
import { type Store, isBlockedBetween } from '../db/store'
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
      // 排除被拉黑者：与首呼(emergency.ts)/未报到(checkin.ts)同口径——用户已拍板"完全排除被拉黑联系人"(iter62)。
      // 升级重呼此前**漏了**这层过滤(iter62 只改了首呼与未报到扇出)：被明确拉黑者仍会在告警满 thresholdMs 无人
      // 确认时收到这条"最后兜底"重呼，附盲人当前/最后已知 GPS(+isEmergency 链的 hasMedical) → 正是要杜绝的、给
      // 为安全而拉黑之人播行踪(见对抗复审姊妹缺口)。
      const acceptedLinks = store.linksByOwner(e.userId).filter((l) => (l.status ?? 'accepted') === 'accepted' && !isBlockedBetween(store, e.userId, l.memberId))
      const emergencyMemberIds = new Set(acceptedLinks.filter((l) => l.isEmergency).map((l) => l.memberId))
      const members = acceptedLinks.map((l) => store.findById(l.memberId)).filter((m): m is NonNullable<typeof m> => !!m)
      const hasLoc = e.lat != null && e.lon != null
      // 发起人是否填了紧急医疗信息：与首呼(emergency.ts)/未报到(checkin.ts)同口径带 hasMedical——升级重呼恰是要抓
      // **漏看首呼**的人，他们只见到这条，若不带 hasMedical 就不知有过敏/用药/病史可查（医疗急救刚需，见复审 missed-sibling）。
      // **仅置给紧急联系人**（他们才可读医疗信息，与 medical 路由授权一致；三链同口径，见 emergency.ts）。
      // getMedicalInfo 是**非必需**增强读：better-sqlite3 会在 SQLITE_BUSY/IOERR **同步抛**，而此处事件已 markEscalated
      // （免反复扫）+ 后台 tick 无重试——这句若抛，外层 try 吞掉后整条升级重呼被跳过、漏看首呼的人**永远收不到**
      // 这最后一层兜底。故必须隔离（与 emergency.ts/checkin.ts 同款）：读失败退化为不标医疗信息，重呼照送全体。
      let hasMedical = false
      try { hasMedical = !!store.getMedicalInfo(sender.id) } catch { /* 非必需读失败不阻断升级重呼扇出 */ }
      const minutes = Math.max(1, Math.round((now - e.at) / 60_000))
      const notifData: Record<string, string> = {
        kind: 'emergency_alert', type: 'emergency_alert', escalated: '1', fromId: sender.id, fromName: sender.displayName, eventId: e.id, alertKind: e.kind,
      }
      if (hasLoc) { notifData.lat = String(e.lat); notifData.lon = String(e.lon); if (e.locSource) notifData.locSource = e.locSource }
      for (const m of members) {
        const l = pushLang(m.language)
        const title = pushStrings.emergencyEscalateTitle(sender.displayName, l)
        const body = pushStrings.emergencyEscalateBody(minutes, hasLoc, l)
        const mMedical = hasMedical && emergencyMemberIds.has(m.id) // hasMedical 仅给紧急联系人（见上）
        const mNotif = mMedical ? { ...notifData, hasMedical: '1' } : notifData
        // 持久化通知发给每个 accepted 亲友（含无 token 者：通知中心兜底），与首呼同口径。
        try { store.createNotification({ id: randomUUID(), userId: m.id, kind: 'emergency_alert', title, body, data: mNotif, createdAt: now }) } catch { /* 通知失败不阻断推送 */ }
        // badge=该亲友未读总数（含刚写入的升级重呼本条），APNs+Web Push 同带（后者供 SW 置 PWA 图标角标）；一次算、两渠道复用。
        const badge = safeBadge(m.id)
        if (webPush.configured) for (const sub of safeSubs(m.id)) void webPush.send(sub, JSON.stringify({ title, body, badge, data: mNotif })).catch(() => { /* 单订阅失败不阻断 */ })
        if (m.apnsToken) {
          const extra: Record<string, string> = { type: 'emergency_alert', escalated: '1', kind: e.kind, fromId: sender.id, eventId: e.id }
          // locSource 与 notifData 同带（此前 extra 漏）：iOS 靠它诚实标注"最后已知·非实时"，缺了会把陈旧位置当实时
          // 渲染、把响应者指向错误地点。locAgeSec 两渠道都不带（升级时已过数分钟，存库的旧龄会误导，故一律省，见 notifData）。
          if (hasLoc) { extra.lat = String(e.lat); extra.lon = String(e.lon); if (e.locSource) extra.locSource = e.locSource }
          if (mMedical) extra.hasMedical = '1'
          void push.sendAlert(m.apnsToken, title, body, extra, undefined, badge).catch(() => { /* 单点失败不阻断 */ })
        }
      }
      escalated++
    } catch { /* 单事件升级失败不阻断其余（已 markEscalated 则不再重试同一条） */ }
  }
  return escalated
}
