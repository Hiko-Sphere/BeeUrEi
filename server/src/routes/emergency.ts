import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { type PresenceRegistry } from '../assist/presence'
import { type LiveLocationRegistry } from '../location/liveLocations'
import { planEmergencyRoute } from '../emergency/routing'
import { broadcastAllClear } from '../emergency/allClear'
import { NoopPushSender, type PushSender } from '../push/apns'
import { NoopWebPushSender, type WebPushSender } from '../push/webPush'
import { pushLang, pushStrings } from '../push/pushStrings'
import { notifyUser } from '../notifications/notify'
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

  // 应急就绪自检：在真正遇险**之前**告诉本人「我的紧急联系人此刻能不能收到即时告警」。SOS 一定会写进对方
  // 收件箱（打开 App 就看得到），但**即时推送**需对方装了 App 且开了通知（有 APNs token 或 Web 推送订阅）——
  // 若指定的紧急联系人全都没有推送通道，SOS 只会静静躺在对方收件箱、错过黄金时间，而本人此前**无从知晓**这条
  // 安全网已悄然失效。医疗警报设备的「按键自检」同理。仅报本人自己的紧急联系人（本就是本人数据，不泄露他人）。
  // reachable 语义=能收到**即时推送**（非"能否收到告警"——无推送者仍会进收件箱），客户端据此提示"请对方开通知"。
  app.get('/api/emergency/readiness', { preHandler: requireAuth() }, async (req) => {
    const allAccepted = store.linksByOwner(req.user!.sub).filter((l) => (l.status ?? 'accepted') === 'accepted')
    const emergencyLinks = allAccepted.filter((l) => l.isEmergency)
    // 与告警扇出时的 hasRealtimePush 同口径（emergency/alert 内）：有 APNs token 或（Web 推送已配置且有订阅）即可即时触达。
    const isReachable = (uid: string, apnsToken?: string): boolean =>
      !!apnsToken || (webPush.configured && safeWebPushSubs(uid).length > 0)
    const linkReachable = (l: { memberId: string }): boolean => {
      const u = store.findById(l.memberId)
      return !!u && isReachable(u.id, u.apnsToken)
    }
    const contacts = emergencyLinks.map((l) => {
      const u = store.findById(l.memberId)
      return { name: u?.displayName ?? '—', relation: l.relation, reachable: !!u && isReachable(u.id, u.apnsToken) }
    })
    return {
      hasEmergencyContact: emergencyLinks.length > 0,
      total: emergencyLinks.length,
      reachable: contacts.filter((c) => c.reachable).length,
      contacts,
      // **实际告警面**：SOS(trigger)/摔倒(alert) 都扇给**全体 accepted 联系人**（非仅 isEmergency——后者仅额外
      // 授予医疗信息可见）。故就绪判定须以全体 accepted 为准，否则"有联系人却没标紧急"会误报"无人会被通知"（假警报）。
      acceptedTotal: allAccepted.length,
      acceptedReachable: allAccepted.filter(linkReachable).length,
    }
  })

  // 我作为紧急联系人「负责的人」此刻有没有未处理的紧急情况（helper 一眼看板）：漏看推送时的兜底——
  // 把"我是紧急联系人的那些人"当前**未解除**的告警聚合出来。隐私一致：我本就是其 accepted 紧急联系人、
  // 会收到其告警+位置，故此处呈现不越权（仅未解除、近 24h、且我确为其 accepted∧isEmergency 联系人）。
  app.get('/api/emergency/watching', { preHandler: requireAuth() }, async (req) => {
    const me = req.user!.sub
    const now = Date.now()
    const windowMs = 24 * 60 * 60 * 1000
    // 谁把我设为了 accepted 紧急联系人 → 我对其负责（linksByMember=我作为 member 的链）。
    const ownerIds = new Set(store.linksByMember(me)
      .filter((l) => (l.status ?? 'accepted') === 'accepted' && l.isEmergency)
      .map((l) => l.ownerId))
    const active: { ownerId: string; ownerName: string; eventId: string; kind: string; at: number; acked: boolean; escalated: boolean; lat: number | null; lon: number | null; hasMedical: boolean }[] = []
    for (const ownerId of ownerIds) {
      const owner = store.findById(ownerId)
      if (!owner || owner.status !== 'active') continue
      for (const e of store.emergencyEventsForUser(ownerId)) {
        if (e.resolvedAt != null || e.at <= now - windowMs) continue // 仅未解除、近 24h
        active.push({ ownerId, ownerName: owner.displayName, eventId: e.id, kind: e.kind, at: e.at,
          acked: e.ackedAt != null, escalated: e.escalatedAt != null, lat: e.lat ?? null, lon: e.lon ?? null,
          // 该人是否有紧急医疗信息（我是其紧急联系人、有权读）——响应者据此一键查看过敏/用药/病史（施救刚需）。
          hasMedical: !!store.getMedicalInfo(ownerId) })
      }
    }
    // 分诊排序（最需要行动者置顶，非只按时间）：升级后仍无人响应 > 尚无人响应 > 已有人响应；同档内新的在前。
    // 让协助者一眼先看到"没人管的、升级过的"那条，而非被一条刚发但已有人响应的挤到上面。
    const urgency = (e: { acked: boolean; escalated: boolean }): number => (e.escalated && !e.acked ? 2 : !e.acked ? 1 : 0)
    active.sort((a, b) => urgency(b) - urgency(a) || b.at - a.at)
    return { active }
  })

  // 本人紧急事件历史回看（医疗警报标配"alert history"）：过往 SOS/摔倒/撞击告警——何时、触达几人、
  // 是否有人响应(ack)、是否已升级、是否已报平安(resolved)。此前 emergencyEventsForUser 仅供自助导出，
  // 无端点、web 无从看（死功能）。近 30 条，倒序，仅展示字段 + 可选坐标供"在地图查看"。
  app.get('/api/emergency/history', { preHandler: requireAuth() }, async (req) => {
    const events = store.emergencyEventsForUser(req.user!.sub).slice(0, 30)
    return {
      history: events.map((e) => ({
        id: e.id,
        kind: e.kind, // fall | crash | manual
        at: e.at,
        notified: e.notified,
        contacts: e.contacts,
        acked: e.ackedAt != null,       // 是否有亲友"知道了"
        escalated: e.escalatedAt != null, // 是否因无人响应升级重呼
        resolved: e.resolvedAt != null, // 是否已报平安解除
        lat: e.lat ?? null,
        lon: e.lon ?? null,
      })),
    }
  })

  // 测试告警投递（医疗警报行业标配"test your alert"）：用户主动发一条**明确标注为测试**的通知给自己的
  // 联系人，真正验证告警链路能送达（就绪自检只查"有推送通道"，测试则真发一条）。与真实告警口径一致地
  // 扇给全体 accepted 联系人；但**不**建紧急事件、不升级、不带位置、kind=delivery_check（非危急词、受勿扰
  // 约束——不会半夜为一条测试惊动联系人）。限流 3/时防骚扰联系人。notifyUser 走 in-app+APNs+WebPush 同款通道。
  app.post('/api/emergency/test', { preHandler: requireAuth(),
                                    config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (req, reply) => {
    const me = store.findById(req.user!.sub)
    if (!me) return reply.code(404).send({ error: 'not_found' })
    const links = store.linksByOwner(me.id).filter((l) => (l.status ?? 'accepted') === 'accepted')
    const members = links.map((l) => store.findById(l.memberId)).filter((m): m is NonNullable<typeof m> => !!m)
    const isReachable = (m: NonNullable<ReturnType<typeof store.findById>>): boolean =>
      !!m.apnsToken || (webPush.configured && safeWebPushSubs(m.id).length > 0)
    for (const member of members) {
      const l = pushLang(member.language)
      // best-effort：单个联系人通知失败绝不中断其余（notifyUser 内部已 try/catch，此处再兜一层）。
      try {
        notifyUser(store, pushSender, member.id, 'delivery_check',
          pushStrings.emergencyTestTitle(me.displayName, l), pushStrings.emergencyTestBody(me.displayName, l),
          { fromId: me.id, fromName: me.displayName })
      } catch { /* 测试通知不可因单点失败中断 */ }
    }
    return { ok: true, notified: members.filter(isReachable).length, contacts: links.length }
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
    const notifData: Record<string, string> = { kind: parsed.data.kind, type: 'emergency_alert', fromId: me.id, fromName: me.displayName, eventId }
    if (hasLoc) {
      extraBase.lat = String(lat); extraBase.lon = String(lon)
      notifData.lat = String(lat); notifData.lon = String(lon)
      if (locSource) { extraBase.locSource = locSource; notifData.locSource = locSource }
      if (locAgeSec != null) { extraBase.locAgeSec = String(locAgeSec); notifData.locAgeSec = String(locAgeSec) }
    }
    // 告警时刻电量（结构化随带，正文段见 emergencyAlertBody）：亲友据此判断联系窗口。
    if (parsed.data.battery != null) { extraBase.battery = String(parsed.data.battery); notifData.battery = String(parsed.data.battery) }
    // 发起人是否填了紧急医疗信息：hasMedical 标志**仅置给紧急联系人**——医疗信息读取端点本就仅紧急联系人可见
    // （见 medical 路由授权），标志须与读权限一致：给普通联系人置此标志，只会让其点"查看医疗信息"却拿 403（假提示），
    // 还多泄露"此人有医疗信息在案"（敏感）。故不再挂到共享 notifData/extraBase，改在下方按每个联系人是否紧急分别置。
    // 注释本意即"让紧急联系人被提示"，此前实现却广播给全体——修正为与授权一致。**不影响告警本身送达全体**。
    const senderHasMedical = !!store.getMedicalInfo(me.id)
    const emergencyMemberIds = new Set(links.filter((l) => l.isEmergency).map((l) => l.memberId))
    await Promise.allSettled(members.map((member) => {
      const l = pushLang(member.language)
      const title = pushStrings.emergencyAlertTitle(me.displayName, l)
      const body = pushStrings.emergencyAlertBody(parsed.data.kind, hasLoc, l, parsed.data.battery)
      // hasMedical 仅发给紧急联系人（他们才可读医疗信息）：普通联系人用不带该标志的 base 数据（见上）。
      const wantMedical = senderHasMedical && emergencyMemberIds.has(member.id)
      const mNotif = wantMedical ? { ...notifData, hasMedical: '1' } : notifData
      const mExtra = wantMedical ? { ...extraBase, hasMedical: '1' } : extraBase
      // 持久化通知发给**每个** accepted 亲友（含无 APNs token 者：web-only 协助者 / 推送被拒 /
      // token 未注册）——否则这些人对摔倒/车祸告警完全无感。这正是"错过推送也能在通知中心回看"
      // 兜底要覆盖的对象，绝不能再按 token 过滤（旧实现把兜底也漏给了最需要它的人）。
      // best-effort：写入失败绝不能中断对其余亲友的告警推送。
      try {
        store.createNotification({ id: randomUUID(), userId: member.id, kind: 'emergency_alert', title, body, data: mNotif, createdAt: Date.now() })
      } catch { /* 通知不可阻断安全攸关的告警推送 */ }
      // badge=该亲友未读总数（含刚写入的本条告警），与图标角标主线一致；APNs+Web Push 同带（后者供 SW 置 PWA 图标角标）。
      const badge = safeBadge(member.id)
      // Web Push：该亲友的浏览器订阅（web-only 协助者关标签页也能收到系统通知）。
      // 与 APNs 并行、各自 best-effort；负载给 SW 渲染系统通知 + 点击跳通知页 + 置图标角标（badge 顶层）。
      const webJobs = webPush.configured
        ? safeWebPushSubs(member.id).map((sub) =>
            webPush.send(sub, JSON.stringify({ title, body, badge, data: mNotif })).catch(() => { /* 单订阅失败不阻断 */ }))
        : []
      // APNs 推送仅发给有 token 的；无 token 者靠持久化通知 + Web Push 兜底。
      const apnsJob = member.apnsToken
        ? pushSender.sendAlert(member.apnsToken, title, body, mExtra, undefined, badge)
        : Promise.resolve()
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
    // true=响应者**正在赶去**（比"已看到"更进一步）：遇险者据此知救援真在路上、可安心等待；其余亲友据此知有人已动身。
    // 可选，缺省=普通"已看到"回执（向后兼容：旧客户端不带此字段，行为不变）。
    onMyWay: z.boolean().optional().catch(undefined),
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
    const onMyWay = parsed.data.onMyWay === true // 响应者正在赶去（比"已看到"更进一步的安心信号）
    // 去重键含状态(seen/way)：同一响应者对同一事件重复**同状态**回执不再打扰遇险者；但 seen→"我在赶来"是有意义的
    // **升级**（遇险者最需要知道救援是否真在路上），须放行——故 seen 与 way 各占一键、各可发一次、均不可重复(防轰炸)。
    const key = `${fromId}:${eventId ?? 'noid'}:${acker.id}:${onMyWay ? 'way' : 'seen'}`
    if (ackDedup.check(key, now) !== undefined) return { ok: true, deduped: true } // 已回告过（同状态），不再重复打扰遇险者

    // 是否**首个**确认（据此只在第一位响应者出现时向其余亲友广播"已有人在响应"，一次事件一条协调通知）。
    // 须在 markEmergencyAcked **之前**读；须是**真实存在且未确认**的事件——防伪造 eventId 触发虚假协调广播
    // （acker 已过"须为发起人已接受亲友"授权，但仍不该凭空捏造事件骚扰其余亲友）。无 eventId 的老告警不广播。
    const ackedEvent = eventId ? store.emergencyEventsForUser(fromId).find((e) => e.id === eventId) : undefined
    const isFirstAck = !!ackedEvent && !ackedEvent.ackedAt
    // 有亲友确认 → 记 ackedAt：后台升级重呼据此跳过（已有人在响应，不必再打扰全体）。best-effort。
    if (eventId) { try { store.markEmergencyAcked(eventId, now) } catch { /* 标记失败不阻断回告 */ } }

    const l = pushLang(sender.language)
    const title = onMyWay ? pushStrings.emergencyOnMyWayTitle(acker.displayName, l) : pushStrings.emergencyAckTitle(acker.displayName, l)
    const body = onMyWay ? pushStrings.emergencyOnMyWayBody(acker.displayName, l) : pushStrings.emergencyAckBody(acker.displayName, l)
    // kind='emergency_ack'：客户端据此区别于 'emergency_alert'——**绝不**触发遇险告警的响铃/大模态，
    // 只作普通通知（web pickUnreadEmergencies 已排除本 kind；iOS 告警模态仅由本机跌倒检测驱动，不受推送触发）。
    const data: Record<string, string> = { kind: 'emergency_ack', fromId: acker.id, fromName: acker.displayName }
    if (onMyWay) data.onMyWay = '1' // 客户端据此把"X 正在赶来"渲染得比"已看到"更醒目
    if (eventId) data.eventId = eventId
    try {
      store.createNotification({ id: randomUUID(), userId: sender.id, kind: 'emergency_ack', title, body, data, createdAt: Date.now() })
    } catch { /* 通知失败不阻断回告推送 */ }
    // badge=发起人未读总数（含刚写入的回告本条），APNs+Web Push 同带（后者供 SW 置 PWA 图标角标）；一次算、两渠道复用。
    const badge = safeBadge(sender.id)
    const webJobs = webPush.configured
      ? store.webPushSubscriptionsForUser(sender.id).map((sub) => webPush.send(sub, JSON.stringify({ title, body, badge, data })).catch(() => { /* 单订阅失败不阻断 */ }))
      : []
    const apnsJob = sender.apnsToken
      ? pushSender.sendAlert(sender.apnsToken, title, body, { type: 'emergency_ack', fromId: acker.id }, undefined, badge)
      : Promise.resolve()
    await Promise.allSettled([apnsJob, ...webJobs])
    metrics?.inc('emergency_acks_total') // 人响应漏斗：确认数 vs 告警数（ack 率低=告警没被看见/没人管，值得告警）

    // 响应者协调：第一位亲友响应时，**安静**通知发起人的其余已接受亲友"已有人在处理"——避免全体同时赶去/
    // 同时打电话把遇险者淹没，也避免"都以为别人在管"没人去。匿名（不点名响应者，零新增身份暴露：收件人本就
    // 都收到了该次告警）。kind='emergency_responding' 不在 web 告警白名单里→绝不弹响铃大模态，只作普通通知。
    if (isFirstAck) {
      const coResponders = store.linksByOwner(fromId)
        .filter((l) => (l.status ?? 'accepted') === 'accepted' && l.memberId !== acker.id)
        .map((l) => store.findById(l.memberId))
        .filter((m): m is NonNullable<typeof m> => !!m)
      const rData: Record<string, string> = { kind: 'emergency_responding', fromId: sender.id, fromName: sender.displayName }
      if (onMyWay) rData.onMyWay = '1' // 其余亲友据此知有人**已动身**（非仅"在响应"），更可安心待命
      if (eventId) rData.eventId = eventId
      const jobs: Promise<unknown>[] = []
      for (const m of coResponders) {
        const ml = pushLang(m.language)
        const rTitle = onMyWay ? pushStrings.emergencyRespondingOnMyWayTitle(sender.displayName, ml) : pushStrings.emergencyRespondingTitle(sender.displayName, ml)
        const rBody = onMyWay ? pushStrings.emergencyRespondingOnMyWayBody(sender.displayName, ml) : pushStrings.emergencyRespondingBody(sender.displayName, ml)
        try { store.createNotification({ id: randomUUID(), userId: m.id, kind: 'emergency_responding', title: rTitle, body: rBody, data: rData, createdAt: Date.now() }) } catch { /* 单条通知失败不阻断其余 */ }
        // badge=该亲友未读总数（含刚写入的"已有人响应"本条），APNs+Web Push 同带（后者供 SW 置 PWA 图标角标）；一次算、两渠道复用。
        const rBadge = safeBadge(m.id)
        if (webPush.configured) for (const sub of safeWebPushSubs(m.id)) jobs.push(webPush.send(sub, JSON.stringify({ title: rTitle, body: rBody, badge: rBadge, data: rData })).catch(() => { /* 单订阅失败不阻断 */ }))
        if (m.apnsToken) jobs.push(pushSender.sendAlert(m.apnsToken, rTitle, rBody, { type: 'emergency_responding', fromId: sender.id }, undefined, rBadge).catch(() => { /* 单点失败不阻断 */ }))
      }
      await Promise.allSettled(jobs)
      metrics?.inc('emergency_responding_total') // 协调触发数（有人开始响应、通知了其余亲友）
    }

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
    // 解除最近一条未解除事件 + 广播"我没事了"给已接受亲友（共用 broadcastAllClear——与安全报到 /complete 同一条解除路径，
    // 免逻辑分叉）。alertId 供客户端消掉对应告警模态。
    const res = broadcastAllClear(store, pushSender, webPush, me.id, now,
      parsed.data.alertId ? { alertId: parsed.data.alertId } : {})
    metrics?.inc('emergency_allclears_total') // 人响应漏斗：报平安数（解除闭环——告警最终有多少被本人解除）
    clearDedup.record(key, { ok: true }, now)
    return { ok: true, notified: res.notified }
  })
}
