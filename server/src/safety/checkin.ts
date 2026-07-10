import { randomUUID } from 'node:crypto'
import type { Store } from '../db/store'
import type { PushSender } from '../push/apns'
import type { WebPushSender } from '../push/webPush'
import { pushLang, pushStrings } from '../push/pushStrings'
import { totalUnreadFor } from '../db/unread'
import { localMinuteOfDay, localDayIn } from '../notifications/quietHours'

/// 每日定时安全报到（Snug Safety 式）：到点自动为用户开启一次报到计时器（dead-man's switch），
/// 超时未报平安走既有 fireExpiredSafetyTimers 告警亲友。由后台每分钟 tick 调用。
/// - **先落 lastDay 再扇出**（幂等：一天至多自动开一次，即便通知/推送失败也不重复）；
/// - 开启窗口 = [startMinute, startMinute+graceMinutes)：服务端宕机恢复超宽限则当天跳过（几小时后才开启的
///   "每日报到"已失去当天意义，且会在错误时刻到期告警——与 fireExpired 的陈旧宽限同哲学，诚实跳过不迟发）；
/// - 已有进行中的报到（手动开的）→ 标记当天已处理但不叠开（一人至多一个 active，与手动 start 语义一致）；
/// - 坏/缺 tz → 跳过（fail-open 口径同 quietHours：绝不回退服务器时区在错误时刻开启）；
/// - best-effort 故障隔离：单用户失败绝不中断其余。返回实际自动开启数。
export function startDueDailyCheckins(store: Store, push: PushSender, webPush: WebPushSender, now: number, graceMinutes = 60): number {
  const safeSubs = (uid: string) => { try { return store.webPushSubscriptionsForUser(uid) } catch { return [] } }
  const safeBadge = (uid: string): number | undefined => { try { return totalUnreadFor(store, uid).total } catch { return undefined } }
  let started = 0
  for (const u of store.allUsers()) {
    try {
      const cfg = u.dailyCheckin
      if (!cfg?.enabled || u.status !== 'active') continue
      const cur = localMinuteOfDay(now, cfg.tz)
      const day = localDayIn(now, cfg.tz)
      if (cur == null || day == null) continue // 坏 tz：诚实跳过，绝不用服务器时区误开
      if (u.dailyCheckinLastDay === day) continue // 今天已自动开过（幂等）
      if (cur < cfg.startMinute || cur >= cfg.startMinute + graceMinutes) continue // 不在开启窗口（含宕机恢复过晚）
      // 已有进行中的报到（手动开的）：标记当天已处理、不叠开（一人至多一个 active）。
      if (store.activeSafetyTimerForOwner(u.id)) { store.updateUser(u.id, { dailyCheckinLastDay: day }); continue }
      store.updateUser(u.id, { dailyCheckinLastDay: day }) // 先落幂等标记，再建计时器/扇出
      store.createSafetyTimer({
        id: randomUUID(), ownerId: u.id, note: cfg.note?.trim() || undefined,
        startedAt: now, dueAt: now + cfg.durationMinutes * 60_000, status: 'active',
      })
      // 通知本人"已开始，请在 N 分钟内报平安"（in-app + APNs + Web Push；kind 含 checkin → 恒越勿扰、web 点击直达亲友页）。
      const l = pushLang(u.language)
      const title = pushStrings.dailyCheckinStartedTitle(l)
      const body = pushStrings.dailyCheckinStartedBody(cfg.durationMinutes, l)
      const data: Record<string, string> = { kind: 'checkin_started' }
      try { store.createNotification({ id: randomUUID(), userId: u.id, kind: 'safety_checkin_started', title, body, data, createdAt: now }) } catch { /* 通知失败不阻断 */ }
      const badge = safeBadge(u.id)
      if (webPush.configured) for (const sub of safeSubs(u.id)) void webPush.send(sub, JSON.stringify({ title, body, badge, data })).catch(() => { /* 单订阅失败不阻断 */ })
      if (u.apnsToken) void push.sendAlert(u.apnsToken, title, body, { type: 'safety_checkin_started' }, undefined, badge).catch(() => { /* 单点失败不阻断 */ })
      started++
    } catch { /* 单用户失败不阻断其余（已落 lastDay 则不重试当日） */ }
  }
  return started
}

/// 最后已知位置来源（结构化，便于单测注入）。生产传 LiveLocationRegistry（其 lastKnownForEmergency 恰匹配此形状）。
/// 只消费**用户主动开启、且收件人正是这批亲友的共享数据**（该方法内已做窗口/时效约束），不越权。
export interface LastKnownLocationSource {
  lastKnownForEmergency(userId: string, now: number): { lat: number; lng: number; updatedAt: number } | undefined
}

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
/// 到期前提醒**本人**（防遗忘误报——dead-man's switch 头号失败模式：用户忘确认→亲友被无谓惊动→告警疲劳）。
/// 由后台每分钟 tick 调用（与 fireExpiredSafetyTimers 同）。对进入 [dueAt-leadMs, dueAt) 窗口且**足够长**的
/// active 计时器，给本人发一条"快到期，请报平安或延长"的提示，**只发一次**（remindedAt 幂等，绝不重复打扰）。
/// - 只发给**本人**（owner），绝不惊动亲友——这是善意提醒，不是告警；
/// - 先置 remindedAt 再扇出：即便推送失败也不重复提醒（与 fired 幂等同理）；
/// - best-effort：站内通知持久化 + 尽力推送本人设备，单通道失败不中断。
/// 返回实际提醒的计时器数。
export function remindDueSoonSafetyTimers(
  store: Store, push: PushSender, webPush: WebPushSender, now: number, leadMs: number,
): number {
  if (!(leadMs > 0)) return 0
  const due = store.dueSoonUnremindedSafetyTimers(now, leadMs)
  const safeSubs = (uid: string) => { try { return store.webPushSubscriptionsForUser(uid) } catch { return [] } }
  const safeBadge = (uid: string): number | undefined => { try { return totalUnreadFor(store, uid).total } catch { return undefined } }
  let reminded = 0
  for (const t of due) {
    try {
      // 先落 remindedAt：即便下面推送失败也不再重复提醒（幂等，防打扰）。
      store.updateSafetyTimer(t.id, { remindedAt: now })
      const owner = store.findById(t.ownerId)
      if (!owner) continue // 归属者已删号：无从提醒（已置 remindedAt，免反复扫）
      const l = pushLang(owner.language)
      const remainMin = (t.dueAt - now) / 60_000
      const title = pushStrings.safetyCheckinReminderTitle(l)
      const body = pushStrings.safetyCheckinReminderBody(remainMin, t.note, l)
      const data: Record<string, string> = { kind: 'checkin_reminder', timerId: t.id }
      try { store.createNotification({ id: randomUUID(), userId: owner.id, kind: 'safety_checkin_reminder', title, body, data, createdAt: now }) } catch { /* 通知失败不阻断推送 */ }
      // badge=本人未读总数（含刚写入的报到提醒本条），APNs+Web Push 同带（后者供 SW 置 PWA 图标角标）；一次算、两渠道复用。
      const badge = safeBadge(owner.id)
      if (webPush.configured) for (const sub of safeSubs(owner.id)) void webPush.send(sub, JSON.stringify({ title, body, badge, data })).catch(() => { /* 单订阅失败不阻断 */ })
      if (owner.apnsToken) void push.sendAlert(owner.apnsToken, title, body, { type: 'safety_checkin_reminder', timerId: t.id }, undefined, badge).catch(() => { /* 单点失败不阻断 */ })
      reminded++
    } catch { /* 单条提醒失败不阻断其余（已置 remindedAt 则不再重试同一条） */ }
  }
  return reminded
}

export function fireExpiredSafetyTimers(
  store: Store, push: PushSender, webPush: WebPushSender, now: number, staleGraceMs: number,
  live?: LastKnownLocationSource,
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
          // badge=本人未读总数（含刚写入的报到超时本条），APNs+Web Push 同带（后者供 SW 置 PWA 图标角标）；一次算、两渠道复用。
          const badge = safeBadge(owner.id)
          if (webPush.configured) for (const sub of safeSubs(owner.id)) void webPush.send(sub, JSON.stringify({ title, body, badge, data })).catch(() => { /* 单订阅失败不阻断 */ })
          if (owner.apnsToken) void push.sendAlert(owner.apnsToken, title, body, { type: 'safety_checkin_expired', timerId: t.id }, undefined, badge).catch(() => { /* 单点失败不阻断 */ })
        }
        continue
      }
      const eventId = randomUUID()
      // 先落 fired + eventId：即便后续推送部分失败也不重复告警（幂等）。
      store.updateSafetyTimer(t.id, { status: 'fired', firedAt: now, eventId })
      const sender = store.findById(t.ownerId)
      if (!sender) continue // 归属者已删号：无从告警（已 markFired，免反复扫）

      const acceptedLinks = store.linksByOwner(t.ownerId).filter((l) => (l.status ?? 'accepted') === 'accepted')
      const emergencyMemberIds = new Set(acceptedLinks.filter((l) => l.isEmergency).map((l) => l.memberId))
      const members = acceptedLinks.map((l) => store.findById(l.memberId)).filter((m): m is NonNullable<typeof m> => !!m)

      const hasRealtimePush = (uid: string, apnsToken?: string): boolean =>
        !!apnsToken || (webPush.configured && safeSubs(uid).length > 0)
      const notified = members.filter((m) => hasRealtimePush(m.id, m.apnsToken)).length

      // 位置兜底：后台 tick 无实时定位，但若本人正在共享位置，取其**最后已知位置**附给亲友——否则"未报到"
      // 告警不带位置，家人不知道去哪找人。与 SOS/摔倒告警同款 lastKnownForEmergency（只取用户主动开启、
      // 且收件人正是这批亲友的共享数据，不越权；locSource='lastKnown'+locAgeSec 让客户端诚实标注"最后已知·N 分钟前"）。
      let lat: number | undefined, lon: number | undefined, locSource = 'none', locAgeSec: number | undefined
      const last = live?.lastKnownForEmergency(sender.id, now)
      if (last && Number.isFinite(last.lat) && Number.isFinite(last.lng)) {
        lat = last.lat; lon = last.lng; locSource = 'lastKnown'
        locAgeSec = Math.max(0, Math.round((now - last.updatedAt) / 1000))
      }

      // kind='checkin' 供 admin/审计区分"未报到"与摔倒/车祸/手动 SOS。notified/contacts 口径同告警首呼。
      try {
        store.createEmergencyEvent({ id: eventId, userId: sender.id, kind: 'checkin',
          lat, lon, locSource, locAgeSec, notified, contacts: members.length, at: now })
      } catch { /* 事件日志失败不阻断告警扇出 */ }

      // 通知类别用 'emergency_alert'：亲友端已有的告警显著度/图标/"回拨"按钮/**位置地图链接**全部生效（零客户端改动）。
      // data.kind='checkin' + data.fromName 供渲染与回拨目标；正文点明是"未报到"并带备注；带 lat/lon 则 web/iOS 渲染地图链接。
      // type='emergency_alert'：与 SOS 首呼/升级同口径的**统一紧急标记**，让 web SW 可靠判紧急（requireInteraction
      // + 按 fromId 分条不折叠）——安全报到未到是 dead-man's switch 真紧急，绝不能在家人浏览器里静默或被折叠。
      const notifData: Record<string, string> = { kind: 'checkin', type: 'emergency_alert', fromId: sender.id, fromName: sender.displayName, eventId }
      if (lat != null && lon != null) {
        notifData.lat = String(lat); notifData.lon = String(lon); notifData.locSource = locSource
        if (locAgeSec != null) notifData.locAgeSec = String(locAgeSec)
      }
      // 发起人有紧急医疗信息 → **仅提示紧急联系人**查看（他们才可读医疗信息，与 medical 路由授权一致；三链同口径，
      // 见 emergency.ts）。此前挂到共享 notifData/extra 广播给全体，普通联系人点"查看医疗信息"只会拿 403（假提示）
      // 且多泄露"此人有医疗信息在案"——改为按联系人是否紧急分别置。**不影响告警本身送达全体**。
      // getMedicalInfo 是**非必需**增强读（仅决定 hasMedical 标志）：better-sqlite3 会在 SQLITE_BUSY/IOERR **同步抛**。
      // 此处 timer 已在上方 markFired（免反复扫），且是后台 tick 无客户端重试——这句若抛，外层 try 吞掉后整条
      // 未报到告警扇出被跳过、亲友**永远收不到**这次 dead-man's-switch 告警，且 timer 已 fired 不再重扫。故必须隔离：
      // 读失败退化为不标医疗信息，告警照送全体（与 emergency.ts SOS 首呼同款修复）。
      let hasMedical = false
      try { hasMedical = !!store.getMedicalInfo(sender.id) } catch { /* 非必需读失败不阻断未报到告警扇出 */ }
      for (const m of members) {
        const l = pushLang(m.language)
        const title = pushStrings.safetyCheckinMissedTitle(sender.displayName, l)
        const body = pushStrings.safetyCheckinMissedBody(t.note, l)
        const mMedical = hasMedical && emergencyMemberIds.has(m.id) // hasMedical 仅给紧急联系人（见上）
        const mNotif = mMedical ? { ...notifData, hasMedical: '1' } : notifData
        // 持久化通知发给每个 accepted 亲友（含无 token 者：通知中心兜底），与紧急首呼同口径。
        try { store.createNotification({ id: randomUUID(), userId: m.id, kind: 'emergency_alert', title, body, data: mNotif, createdAt: now }) } catch { /* 通知失败不阻断推送 */ }
        // badge=该亲友未读总数（含刚写入的未报到告警本条），APNs+Web Push 同带（后者供 SW 置 PWA 图标角标）；一次算、两渠道复用。
        const badge = safeBadge(m.id)
        if (webPush.configured) for (const sub of safeSubs(m.id)) void webPush.send(sub, JSON.stringify({ title, body, badge, data: mNotif })).catch(() => { /* 单订阅失败不阻断 */ })
        if (m.apnsToken) {
          const extra: Record<string, string> = { type: 'emergency_alert', kind: 'checkin', fromId: sender.id, eventId }
          if (lat != null && lon != null) {
            extra.lat = String(lat); extra.lon = String(lon); extra.locSource = locSource
            if (locAgeSec != null) extra.locAgeSec = String(locAgeSec)
          }
          if (mMedical) extra.hasMedical = '1'
          void push.sendAlert(m.apnsToken, title, body, extra, undefined, badge).catch(() => { /* 单点失败不阻断 */ })
        }
      }
      fired++
    } catch { /* 单条报到告警失败不阻断其余（已 markFired/expired 则不再重试同一条） */ }
  }
  return fired
}
