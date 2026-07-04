import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { type PresenceRegistry } from '../assist/presence'
import { type LiveLocationRegistry } from '../location/liveLocations'
import { planEmergencyRoute } from '../emergency/routing'
import { NoopPushSender, type PushSender } from '../push/apns'
import { NoopWebPushSender, type WebPushSender } from '../push/webPush'
import { pushLang, pushStrings } from '../push/pushStrings'
import { totalUnreadFor } from '../db/unread'
import type { Metrics } from '../metrics/metrics'

const alertSchema = z.object({
  kind: z.enum(['fall', 'crash', 'manual']), // manual=用户手动 SOS（未实名门禁屏等处的紧急按钮）

  // ⚠️ 本 schema 的**全部 optional 附注字段都必须 .catch(undefined)**：坏值只丢弃该字段，绝不能 400 掉
  // 整条生命攸关的告警（核心字段 kind 保持严格——没有类别就没有告警语义）。
  // 坐标：GPS 毛刺给出越界值（lat 200 等）→ 丢坐标照发（"附错误位置比不附更危险"同理，hasLoc 对半对儿也免疫）。
  lat: z.number().min(-90).max(90).optional().catch(undefined),
  lon: z.number().min(-180).max(180).optional().catch(undefined),
  // 告警发出时刻的手机电量%：亲友据此判断联系窗口（≤20% 文案点明"可能很快关机"）。仅入首呼即时消息，
  // 不持久化、不随升级重呼重播（几分钟后已陈旧、重播会误导）。
  battery: z.number().int().min(0).max(100).optional().catch(undefined),
  // 幂等键：同一次紧急事件的多次重试带同一 alertId，服务端据此去重——客户端可安全重试提高送达率，
  // 而亲友**不会**因重试收到重复告警。坏 id → 丢弃（失去幂等，重复告警远好过没有告警）。
  alertId: z.string().min(1).max(64).optional().catch(undefined),
})

/// 紧急告警幂等去重（内存，TTL 5 分钟）：记住近期已处理的 (user:alertId) 及其响应，重试直接返回缓存、
/// 不再重复通知。内存足矣——紧急告警罕见、重启罕见，且重启后偶发一次重复远好过漏报。
class EmergencyAlertDedup {
  private seen = new Map<string, { result: unknown; at: number }>()
  private readonly ttlMs = 5 * 60 * 1000
  check(key: string, now: number): unknown | undefined {
    const e = this.seen.get(key)
    return e && now - e.at < this.ttlMs ? e.result : undefined
  }
  record(key: string, result: unknown, now: number): void {
    this.seen.set(key, { result, at: now })
    for (const [k, v] of this.seen) if (now - v.at >= this.ttlMs) this.seen.delete(k) // 顺带清过期
  }
}

export function registerEmergencyRoutes(app: FastifyInstance, store: Store,
                                        presence: PresenceRegistry,
                                        live: LiveLocationRegistry,
                                        pushSender: PushSender = new NoopPushSender(),
                                        webPush: WebPushSender = new NoopWebPushSender(),
                                        metrics?: Metrics): void {
  const alertDedup = new EmergencyAlertDedup()
  // 安全攸关：告警/报平安扇出循环里对每个亲友的**同步 store 读**（web-push 订阅、未读角标）必须各自兜底。
  // better-sqlite3 的 .all()/.get() 会**同步抛**（SQLITE_BUSY 超时/IOERR/坏行），而这些读发生在 members.map()
  // 同步构建 job 数组阶段（在 Promise.allSettled 之前）——一个亲友的读抛错会冒出 map、500 整个请求，掐断对
  // 其余亲友的告警；且此时尚未走到 alertDedup.record，客户端带同一 alertId 重试会重新扇出全体，既漏报又重复
  // 告警（违反第 89 行"任一失败绝不中断其余或 500"与第 77 行"绝不重复告警"两条不变量）。写入(createNotification)
  // 早已 try/catch，读却漏了——此处补齐这条不对称。
  const safeWebPushSubs = (uid: string): ReturnType<Store['webPushSubscriptionsForUser']> => {
    try { return store.webPushSubscriptionsForUser(uid) } catch { return [] }
  }
  const safeBadge = (uid: string): number | undefined => {
    try { return totalUnreadFor(store, uid).total } catch { return undefined }
  }
  // 发起紧急呼叫：返回按优先级排好的呼叫目标列表（真正接通由 WebRTC 信令负责）。
  app.post('/api/emergency/trigger', { preHandler: requireAuth() }, async (req) => {
    const owner = req.user!
    const now = Date.now()
    // 仅 accepted 的绑定可作为紧急联系人（pending 未经对方同意，不参与紧急路由，见审查 #6）。
    const links = store.linksByOwner(owner.sub).filter((l) => (l.status ?? 'accepted') === 'accepted')
    // 同信任层级内在线者优先：遇险先接通此刻真正待命的人，不在离线联系人上白等振铃。
    const ordered = planEmergencyRoute(links, (memberId) => presence.isAvailable(memberId, now))
    const targets = ordered.map((l) => {
      const member = store.findById(l.memberId)
      return {
        memberId: l.memberId,
        memberName: member?.displayName ?? '未知',
        relation: l.relation,
        isEmergency: l.isEmergency,
        isOnline: presence.isAvailable(l.memberId, now), // 供客户端标注"● 在线"，让用户知道先接通谁
      }
    })
    return { targets, count: targets.length }
  })

  // 摔倒/车祸自动警报：检测端确认（倒计时无人取消）后调用——给所有 accepted 绑定的亲友/协助者
  // 发提醒推送（按收件人语言选文案，带可选坐标）。pending 绑定不通知（未经对方同意，同审查 #6 原则）。
  app.post('/api/emergency/alert', { preHandler: requireAuth(),
                                     config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = alertSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const me = store.findById(req.user!.sub)
    if (!me) return reply.code(404).send({ error: 'not_found' })

    // 幂等：同一 alertId 的重试直接返回首次结果，绝不重复通知亲友（客户端可安全重试提高送达率）。
    const dedupKey = parsed.data.alertId ? `${me.id}:${parsed.data.alertId}` : undefined
    if (dedupKey) {
      const cached = alertDedup.check(dedupKey, Date.now())
      if (cached !== undefined) return cached
    }

    const now0 = Date.now()
    // 本次告警的事件 id：先生成，既用于事件日志，又随通知/推送下发给每个亲友——亲友"知道了"回执(ack)
    // 据此精确定位是哪一次告警（同一发起人短时间内多次告警时不混淆）。
    const eventId = randomUUID()
    const links = store.linksByOwner(me.id).filter((l) => (l.status ?? 'accepted') === 'accepted')
    // 安全攸关：所有亲友必须**并行**收到告警，且任一推送失败绝不能中断其余推送或 500 整个请求。
    // 此前串行 await——第一个亲友的 APNs 抛错会让后面所有亲友收不到摔倒告警。
    const members = links
      .map((link) => store.findById(link.memberId))
      .filter((m): m is NonNullable<typeof m> => !!m)

    // 位置：优先用告警自带的当前坐标；**若缺（摔倒后手机丢 GPS，恰是易摔的室内/地库场景）则兜底用
    // 用户最后已知的共享位置**——几分钟前的位置远胜于让家人完全不知道人在哪（对标 Apple Watch 跌倒检测）。
    // 兜底位置仅取自用户主动开启、且收件人正是这批亲友的共享数据，不越权；附 locSource/locAgeSec 让客户端
    // 诚实标注"最后已知·N 分钟前"，不谎称实时。
    let lat = parsed.data.lat, lon = parsed.data.lon
    let locSource: 'live' | 'lastKnown' | undefined = (lat != null && lon != null) ? 'live' : undefined
    let locAgeSec: number | undefined
    if (lat == null || lon == null) {
      const last = live.lastKnownForEmergency(me.id, now0)
      if (last) {
        lat = last.lat; lon = last.lng
        locSource = 'lastKnown'
        locAgeSec = Math.round((now0 - last.updatedAt) / 1000)
      }
    }
    const hasLoc = lat != null && lon != null

    const extraBase: Record<string, string> = { type: 'emergency_alert', kind: parsed.data.kind, fromId: me.id, eventId }
    // 通知记录的 data 形状与推送 extra 一致（去掉 type，记录的 kind 字段已表达类别）。
    // fromName：供协助端（web 通知页）渲染"回拨 X"按钮的呼叫目标显示名。eventId：供"知道了"回执定位本次告警。
    const notifData: Record<string, string> = { kind: parsed.data.kind, fromId: me.id, fromName: me.displayName, eventId }
    if (hasLoc) {
      extraBase.lat = String(lat); extraBase.lon = String(lon)
      notifData.lat = String(lat); notifData.lon = String(lon)
      if (locSource) { extraBase.locSource = locSource; notifData.locSource = locSource }
      if (locAgeSec != null) { extraBase.locAgeSec = String(locAgeSec); notifData.locAgeSec = String(locAgeSec) }
    }
    // 告警时刻电量（结构化随带，正文段见 emergencyAlertBody）：亲友据此判断联系窗口。
    if (parsed.data.battery != null) { extraBase.battery = String(parsed.data.battery); notifData.battery = String(parsed.data.battery) }
    await Promise.allSettled(members.map((member) => {
      const l = pushLang(member.language)
      const title = pushStrings.emergencyAlertTitle(me.displayName, l)
      const body = pushStrings.emergencyAlertBody(parsed.data.kind, hasLoc, l, parsed.data.battery)
      // 持久化通知发给**每个** accepted 亲友（含无 APNs token 者：web-only 协助者 / 推送被拒 /
      // token 未注册）——否则这些人对摔倒/车祸告警完全无感。这正是"错过推送也能在通知中心回看"
      // 兜底要覆盖的对象，绝不能再按 token 过滤（旧实现把兜底也漏给了最需要它的人）。
      // best-effort：写入失败绝不能中断对其余亲友的告警推送。
      try {
        store.createNotification({ id: randomUUID(), userId: member.id, kind: 'emergency_alert', title, body, data: notifData, createdAt: Date.now() })
      } catch { /* 通知不可阻断安全攸关的告警推送 */ }
      // Web Push：该亲友的浏览器订阅（web-only 协助者关标签页也能收到系统通知）。
      // 与 APNs 并行、各自 best-effort；负载给 SW 渲染系统通知 + 点击跳通知页。
      const webJobs = webPush.configured
        ? safeWebPushSubs(member.id).map((sub) =>
            webPush.send(sub, JSON.stringify({ title, body, data: notifData })).catch(() => { /* 单订阅失败不阻断 */ }))
        : []
      // APNs 推送仅发给有 token 的；无 token 者靠持久化通知 + Web Push 兜底。
      const apnsJob = member.apnsToken
        ? pushSender.sendAlert(member.apnsToken, title, body, extraBase, undefined, safeBadge(member.id))
        : Promise.resolve()
      // badge=该亲友未读总数（含刚写入的本条告警），与图标角标主线一致。
      return Promise.allSettled([apnsJob, ...webJobs])
    }))
    // notified=有**实时推送通道**的亲友数（APNs token 或 Web Push 订阅）；contacts=accepted 亲友总数。
    // 二者差值 = 仅靠通知中心兜底、无实时推送通道的人。**必须含 Web Push**——否则 web-only 亲友明明
    // 经浏览器推送收到了告警，却被计成"仅兜底"，污染 admin 紧急事件日志与客户端提示（加 Web Push 后
    // 的口径回归）。
    const hasRealtimePush = (m: NonNullable<ReturnType<typeof store.findById>>): boolean =>
      !!m.apnsToken || (webPush.configured && safeWebPushSubs(m.id).length > 0)
    // location：告知客户端本次告警附带的位置来源——'live'(自带当前坐标)/'lastKnown'(兜底最后已知，
    // 带 ageSec)/'none'(既无当前定位又无可兜底的共享位置，客户端应提示用户"未附位置")。
    const result = {
      ok: true,
      notified: members.filter(hasRealtimePush).length,
      contacts: links.length,
      location: { source: locSource ?? 'none', ...(locAgeSec != null ? { ageSec: locAgeSec } : {}) },
    }
    metrics?.inc('emergency_alerts_total') // 值守可观测：Prometheus 对告警速率设阈值（风暴/异常静默都值得看）
    // 紧急事件日志（治理/值守，admin 可见）：best-effort——日志失败绝不影响告警响应。
    // alertId 重试在上方 dedup 已短路返回，不会重复落账。
    try {
      store.createEmergencyEvent({ id: eventId, userId: me.id, kind: parsed.data.kind,
        lat, lon, locSource: locSource ?? 'none', locAgeSec, notified: result.notified, contacts: result.contacts, at: now0 })
    } catch { /* 日志不可阻断告警 */ }
    if (dedupKey) alertDedup.record(dedupKey, result, Date.now()) // 记住本次结果，后续同 alertId 重试直接返回它
    return result
  })

  // 亲友确认已看到某条紧急告警 → 回告发起人"X 已看到你的求助"。医疗警报/安全类 App 的标配：遇险者
  // 最需要的反馈是"有人在响应"，而非石沉大海。发起人经既有通知+推送链路收到（盲人端 VoiceOver 会念）。
  const ackDedup = new EmergencyAlertDedup() // 复用 TTL 去重：同一(发起人:事件:确认者)5 分钟内只回告一次，防连点轰炸遇险者
  const ackSchema = z.object({
    fromId: z.string().min(1).max(64),           // 发起紧急告警的人（核心字段保持严格：没有对象就没有回告语义）
    // 哪一次告警（缺省则按发起人维度去重）。坏 id → 丢弃照回告：否则整个 ack 400——遇险者收不到
    // "有人已看到"的救命反馈，且 markEmergencyAcked 不落、升级重呼会在已有人响应时仍轰炸全体。
    eventId: z.string().min(1).max(64).optional().catch(undefined),
  })
  app.post('/api/emergency/ack', { preHandler: requireAuth(),
                                   config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = ackSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const acker = store.findById(req.user!.sub)
    if (!acker) return reply.code(404).send({ error: 'not_found' })
    const { fromId, eventId } = parsed.data
    if (fromId === acker.id) return reply.code(400).send({ error: 'invalid_input' }) // 不能确认自己的告警
    // 授权：确认者必须是发起人的**已接受**亲友（发起人是 owner、亲友是 member）——否则任何人都能给
    // 陌生人发"已看到你的求助"骚扰。
    const isContact = store.linksByOwner(fromId).some((l) => (l.status ?? 'accepted') === 'accepted' && l.memberId === acker.id)
    if (!isContact) return reply.code(403).send({ error: 'not_contact' })
    const sender = store.findById(fromId)
    if (!sender) return reply.code(404).send({ error: 'not_found' })

    const now = Date.now()
    const key = `${fromId}:${eventId ?? 'noid'}:${acker.id}`
    if (ackDedup.check(key, now) !== undefined) return { ok: true, deduped: true } // 已回告过，不再重复打扰遇险者

    // 有亲友确认 → 记 ackedAt：后台升级重呼据此跳过（已有人在响应，不必再打扰全体）。best-effort。
    if (eventId) { try { store.markEmergencyAcked(eventId, now) } catch { /* 标记失败不阻断回告 */ } }

    const l = pushLang(sender.language)
    const title = pushStrings.emergencyAckTitle(acker.displayName, l)
    const body = pushStrings.emergencyAckBody(acker.displayName, l)
    // kind='emergency_ack'：客户端据此区别于 'emergency_alert'——**绝不**触发遇险告警的响铃/大模态，
    // 只作普通通知（web pickUnreadEmergencies 已排除本 kind；iOS 告警模态仅由本机跌倒检测驱动，不受推送触发）。
    const data: Record<string, string> = { kind: 'emergency_ack', fromId: acker.id, fromName: acker.displayName }
    if (eventId) data.eventId = eventId
    try {
      store.createNotification({ id: randomUUID(), userId: sender.id, kind: 'emergency_ack', title, body, data, createdAt: Date.now() })
    } catch { /* 通知失败不阻断回告推送 */ }
    const webJobs = webPush.configured
      ? store.webPushSubscriptionsForUser(sender.id).map((sub) => webPush.send(sub, JSON.stringify({ title, body, data })).catch(() => { /* 单订阅失败不阻断 */ }))
      : []
    const apnsJob = sender.apnsToken
      ? pushSender.sendAlert(sender.apnsToken, title, body, { type: 'emergency_ack', fromId: acker.id }, undefined, totalUnreadFor(store, sender.id).total)
      : Promise.resolve()
    await Promise.allSettled([apnsJob, ...webJobs])
    ackDedup.record(key, { ok: true }, now)
    return { ok: true }
  })

  // 报平安（all-clear）：告警发出后，发起人确认没事 → 广播给所有已接受亲友，让刚收到告警而担心/赶来的人
  // 立刻安心。安全类 App（医疗警报/Life360）的标配——告警是单向的、必须有"解除"闭环，否则误报会让家人白跑。
  // 只能解除**自己**的告警（广播给自己的亲友，无需对方是谁的授权检查——发的是给自己联系人的安心消息）。
  const clearDedup = new EmergencyAlertDedup() // 同一(发起人:alertId)5 分钟内只广播一次，防连点
  // 关联哪次告警（供客户端消掉对应告警模态）。坏 id → 丢弃照广播："我没事了"的报平安 400 掉的话，
  // 亲友会继续担心/赶路（安心信号与告警同等生命攸关）。
  const clearSchema = z.object({ alertId: z.string().min(1).max(64).optional().catch(undefined) })
  app.post('/api/emergency/all-clear', { preHandler: requireAuth(),
                                         config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = clearSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const me = store.findById(req.user!.sub)
    if (!me) return reply.code(404).send({ error: 'not_found' })
    const now = Date.now()
    const key = `${me.id}:${parsed.data.alertId ?? 'noid'}`
    if (clearDedup.check(key, now) !== undefined) return { ok: true, deduped: true }
    // 治理可观测：把该用户最近一条未解除的紧急事件标记为已解除，admin 事件列表据此区分"已报平安/误报"
    // 与"可能仍在进行"。best-effort，不阻断广播。
    try { store.resolveLatestEmergencyEvent(me.id, now) } catch { /* 解除标记失败不影响报平安广播 */ }
    const links = store.linksByOwner(me.id).filter((l) => (l.status ?? 'accepted') === 'accepted')
    const members = links.map((l) => store.findById(l.memberId)).filter((m): m is NonNullable<typeof m> => !!m)
    // kind='emergency_clear'：客户端据此区别于告警——绝不触发响铃/大模态，只作普通通知；带 alertId 供
    // 客户端把对应的那条 emergency_alert 告警模态就地消掉（"对方已报平安"）。
    const data: Record<string, string> = { kind: 'emergency_clear', fromId: me.id, fromName: me.displayName }
    if (parsed.data.alertId) data.alertId = parsed.data.alertId
    await Promise.allSettled(members.map((member) => {
      const l = pushLang(member.language)
      const title = pushStrings.emergencyClearTitle(me.displayName, l)
      const body = pushStrings.emergencyClearBody(me.displayName, l)
      try {
        store.createNotification({ id: randomUUID(), userId: member.id, kind: 'emergency_clear', title, body, data, createdAt: Date.now() })
      } catch { /* 通知失败不阻断广播 */ }
      const webJobs = webPush.configured
        ? safeWebPushSubs(member.id).map((sub) => webPush.send(sub, JSON.stringify({ title, body, data })).catch(() => { /* 单订阅失败不阻断 */ }))
        : []
      const apnsJob = member.apnsToken
        ? pushSender.sendAlert(member.apnsToken, title, body, { type: 'emergency_clear', fromId: me.id }, undefined, safeBadge(member.id))
        : Promise.resolve()
      return Promise.allSettled([apnsJob, ...webJobs])
    }))
    clearDedup.record(key, { ok: true }, now)
    return { ok: true, notified: members.length }
  })
}
