import { randomUUID } from 'node:crypto'
import type { Store } from '../db/store'
import type { PushSender } from '../push/apns'
import type { WebPushSender } from '../push/webPush'
import { pushLang, pushStrings } from '../push/pushStrings'
import { totalUnreadFor } from '../db/unread'

/// 到期未确认平安的安全报到 → 自动告警亲友（personal-safety "safety timer" 的核心：dead-man's switch）。
/// 由后台每分钟的定时器调用（index.ts，与紧急升级重呼同 tick），无 HTTP 上下文——扇出模板照搬 escalation.ts：
/// - **先标记状态再扇出**：即便下面推送部分失败也绝不重复告警（幂等，防告警疲劳）；
/// - **best-effort 故障隔离**：单亲友/单通道推送失败绝不中断其余或抛出（同步 store 读均兜底）；
/// - 创建一条 emergency_event（kind='checkin'）让其**汇入既有紧急链路**：亲友可"知道了"(ack)、本人可
///   "报平安"(all-clear) 解除、无人响应满阈值会被升级重呼、admin 紧急事件列表可见。
///
/// **陈旧宽限（防误报风暴）**：若到期时服务端正好宕机、恢复后已超 staleGraceMs（默认 60 分钟），**不迟发告警**
/// （几十分钟前的"未报到"迟发既可能是虚惊、又会在重启时对一批过期计时器同时轰炸亲友）——仅记终态 'expired'。
/// 正常运行时 tick 每 60s 扫一次，到期至多晚 ~60s 触发，远在宽限内。返回**实际告警（fired）**的计时器数。
export function fireExpiredSafetyTimers(
  store: Store, push: PushSender, webPush: WebPushSender, now: number, staleGraceMs: number,
): number {
  const due = store.expiredActiveSafetyTimers(now)
  const safeSubs = (uid: string) => { try { return store.webPushSubscriptionsForUser(uid) } catch { return [] } }
  const safeBadge = (uid: string): number | undefined => { try { return totalUnreadFor(store, uid).total } catch { return undefined } }
  let fired = 0
  for (const t of due) {
    try {
      // 宕机迟到超宽限：**不惊动亲友**（免恢复后一批陈旧计时器同时轰炸=误报风暴），但也**不静默丢弃**——
      // 给本人留一条诚实通知（+ best-effort 推送到本人）：断网期间到期、未替你通知亲友，仍需帮助请手动求助。
      // 这样本人有迹可循、可自救，admin 也能从 'expired' 终态看到"曾有一次报到未能守护"（对抗复审 CONFIRMED#2）。
      if (now - t.dueAt > staleGraceMs) {
        store.updateSafetyTimer(t.id, { status: 'expired' })
        const owner = store.findById(t.ownerId)
        if (owner) {
          const l = pushLang(owner.language)
          const title = pushStrings.safetyCheckinExpiredSelfTitle(l)
          const body = pushStrings.safetyCheckinExpiredSelfBody(l)
          const data: Record<string, string> = { kind: 'checkin_expired', timerId: t.id }
          try { store.createNotification({ id: randomUUID(), userId: owner.id, kind: 'safety_checkin_expired', title, body, data, createdAt: now }) } catch { /* 通知失败不阻断 */ }
          if (webPush.configured) for (const sub of safeSubs(owner.id)) void webPush.send(sub, JSON.stringify({ title, body, data })).catch(() => { /* 单订阅失败不阻断 */ })
          if (owner.apnsToken) void push.sendAlert(owner.apnsToken, title, body, { type: 'safety_checkin_expired', timerId: t.id }, undefined, safeBadge(owner.id)).catch(() => { /* 单点失败不阻断 */ })
        }
        continue
      }
      const eventId = randomUUID()
      // 先落 fired + eventId：即便后续推送部分失败也不重复告警（幂等）。
      store.updateSafetyTimer(t.id, { status: 'fired', firedAt: now, eventId })
      const sender = store.findById(t.ownerId)
      if (!sender) continue // 归属者已删号：无从告警（已 markFired，免反复扫）

      const members = store.linksByOwner(t.ownerId)
        .filter((l) => (l.status ?? 'accepted') === 'accepted')
        .map((l) => store.findById(l.memberId))
        .filter((m): m is NonNullable<typeof m> => !!m)

      const hasRealtimePush = (uid: string, apnsToken?: string): boolean =>
        !!apnsToken || (webPush.configured && safeSubs(uid).length > 0)
      const notified = members.filter((m) => hasRealtimePush(m.id, m.apnsToken)).length

      // emergency_event：无位置（后台 tick 拿不到实时定位；本人若开着实时共享，亲友本就另可见）。
      // kind='checkin' 供 admin/审计区分"未报到"与摔倒/车祸/手动 SOS。notified/contacts 口径同告警首呼。
      try {
        store.createEmergencyEvent({ id: eventId, userId: sender.id, kind: 'checkin',
          locSource: 'none', notified, contacts: members.length, at: now })
      } catch { /* 事件日志失败不阻断告警扇出 */ }

      // 通知类别用 'emergency_alert'：亲友端已有的告警显著度/图标/"回拨"按钮全部生效（零客户端改动）。
      // data.kind='checkin' + data.fromName 供渲染与回拨目标；正文点明是"未报到"并带备注。
      const notifData: Record<string, string> = { kind: 'checkin', fromId: sender.id, fromName: sender.displayName, eventId }
      for (const m of members) {
        const l = pushLang(m.language)
        const title = pushStrings.safetyCheckinMissedTitle(sender.displayName, l)
        const body = pushStrings.safetyCheckinMissedBody(t.note, l)
        // 持久化通知发给每个 accepted 亲友（含无 token 者：通知中心兜底），与紧急首呼同口径。
        try { store.createNotification({ id: randomUUID(), userId: m.id, kind: 'emergency_alert', title, body, data: notifData, createdAt: now }) } catch { /* 通知失败不阻断推送 */ }
        if (webPush.configured) for (const sub of safeSubs(m.id)) void webPush.send(sub, JSON.stringify({ title, body, data: notifData })).catch(() => { /* 单订阅失败不阻断 */ })
        if (m.apnsToken) {
          const extra: Record<string, string> = { type: 'emergency_alert', kind: 'checkin', fromId: sender.id, eventId }
          void push.sendAlert(m.apnsToken, title, body, extra, undefined, safeBadge(m.id)).catch(() => { /* 单点失败不阻断 */ })
        }
      }
      fired++
    } catch { /* 单条报到告警失败不阻断其余（已 markFired/expired 则不再重试同一条） */ }
  }
  return fired
}
