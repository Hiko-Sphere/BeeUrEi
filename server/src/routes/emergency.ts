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

  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  // 幂等键：同一次紧急事件的多次重试带同一 alertId，服务端据此去重——客户端可安全重试提高送达率，
  // 而亲友**不会**因重试收到重复告警（生命攸关：重试宁可有、但绝不该重复轰炸/让家人误以为摔了两次）。
  alertId: z.string().min(1).max(64).optional(),
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

    const extraBase: Record<string, string> = { type: 'emergency_alert', kind: parsed.data.kind, fromId: me.id }
    // 通知记录的 data 形状与推送 extra 一致（去掉 type，记录的 kind 字段已表达类别）。
    // fromName：供协助端（web 通知页）渲染"回拨 X"按钮的呼叫目标显示名。
    const notifData: Record<string, string> = { kind: parsed.data.kind, fromId: me.id, fromName: me.displayName }
    if (hasLoc) {
      extraBase.lat = String(lat); extraBase.lon = String(lon)
      notifData.lat = String(lat); notifData.lon = String(lon)
      if (locSource) { extraBase.locSource = locSource; notifData.locSource = locSource }
      if (locAgeSec != null) { extraBase.locAgeSec = String(locAgeSec); notifData.locAgeSec = String(locAgeSec) }
    }
    await Promise.allSettled(members.map((member) => {
      const l = pushLang(member.language)
      const title = pushStrings.emergencyAlertTitle(me.displayName, l)
      const body = pushStrings.emergencyAlertBody(parsed.data.kind, hasLoc, l)
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
        ? store.webPushSubscriptionsForUser(member.id).map((sub) =>
            webPush.send(sub, JSON.stringify({ title, body, data: notifData })).catch(() => { /* 单订阅失败不阻断 */ }))
        : []
      // APNs 推送仅发给有 token 的；无 token 者靠持久化通知 + Web Push 兜底。
      const apnsJob = member.apnsToken
        ? pushSender.sendAlert(member.apnsToken, title, body, extraBase, undefined, totalUnreadFor(store, member.id).total)
        : Promise.resolve()
      // badge=该亲友未读总数（含刚写入的本条告警），与图标角标主线一致。
      return Promise.allSettled([apnsJob, ...webJobs])
    }))
    // notified=有**实时推送通道**的亲友数（APNs token 或 Web Push 订阅）；contacts=accepted 亲友总数。
    // 二者差值 = 仅靠通知中心兜底、无实时推送通道的人。**必须含 Web Push**——否则 web-only 亲友明明
    // 经浏览器推送收到了告警，却被计成"仅兜底"，污染 admin 紧急事件日志与客户端提示（加 Web Push 后
    // 的口径回归）。
    const hasRealtimePush = (m: NonNullable<ReturnType<typeof store.findById>>): boolean =>
      !!m.apnsToken || (webPush.configured && store.webPushSubscriptionsForUser(m.id).length > 0)
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
      store.createEmergencyEvent({ id: randomUUID(), userId: me.id, kind: parsed.data.kind,
        lat, lon, locSource: locSource ?? 'none', locAgeSec, notified: result.notified, contacts: result.contacts, at: now0 })
    } catch { /* 日志不可阻断告警 */ }
    if (dedupKey) alertDedup.record(dedupKey, result, Date.now()) // 记住本次结果，后续同 alertId 重试直接返回它
    return result
  })
}
