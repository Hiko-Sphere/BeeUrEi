import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store, acceptedContactIds } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { type LiveLocationRegistry } from '../location/liveLocations'
import { evaluateGeofences } from '../location/geofence'
import { TtlDedup } from '../location/ttlDedup'
import { decideLowBatteryWarn } from '../location/lowBattery'
import { type PushSender, NoopPushSender } from '../push/apns'
import { pushLang, pushStrings } from '../push/pushStrings'
import { notifyUser } from '../notifications/notify'

/// 到达围栏状态（纯内存，userId → 当前"在内"的地点 label 集合）：作下次判定的 prevInside。
/// 重启即清（重启后首个更新可能重复提示一次到达，可接受）；规模化可换 Redis。同 PresenceRegistry 惯例。
class GeofenceState {
  private map = new Map<string, Set<string>>()
  has(userId: string): boolean { return this.map.has(userId) } // 是否已建立本会话基线（区分"会话首更新"与"在外全部地点"）
  get(userId: string): Set<string> { return this.map.get(userId) ?? new Set() }
  set(userId: string, labels: string[]): void { this.map.set(userId, new Set(labels)) } // **总是**写（含空集）：标记会话基线已建
  clear(userId: string): void { this.map.delete(userId) } // 停止共享/会话结束：清基线，下次共享首更新重建
}

// 坐标用 z.number()（JSON body，非查询串）：拒非有限值与越界，绝不接受 NaN/Infinity 污染地图。
const updateSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().min(0).max(100_000).optional(), // 米
  heading: z.number().finite().min(0).max(360).optional(),      // 度
  battery: z.number().int().min(0).max(100).optional(),         // 共享者手机电量%（亲友据此在没电前主动联系）
  ttlSec: z.number().int().min(60).max(3600).optional(),        // 本次共享时长（默认/上限见 registry）
})

/// 实时位置共享：盲人与其亲友/协助者互相可见对方当前位置（双方各自独立开关，对等）。
/// 授权边界 = **已接受的绑定关系**（双向，排除黑名单），与呼叫/紧急/聊天一致。位置纯内存、不落库（见 liveLocations）。
export function registerLocationRoutes(app: FastifyInstance, store: Store, live: LiveLocationRegistry,
                                       push: PushSender = new NoopPushSender()): void {
  const geofence = new GeofenceState()
  // 低电量预警会话态：userId → 已提醒层级（0 无 / 1 低电 / 2 极低；滞回复位见 decideLowBatteryWarn）。停止共享即清。
  const lowBatteryLevel = new Map<string, number>()
  // 阈值：跌到 warnAt(默认15%)提醒家人"低电"；再跌到 criticalAt(默认5%)提醒"即将关机"；回升到 clearAt(=warnAt+10)才复位。
  const warnAtPct = (() => { const v = Number(process.env.SHARE_LOW_BATTERY_WARN_PCT); return Number.isFinite(v) && v >= 5 && v <= 50 ? Math.round(v) : 15 })()
  const clearAtPct = Math.min(100, warnAtPct + 10)
  // 极低阈值：env 可调，但恒保证 1 ≤ criticalAt < warnAt（否则两级重叠/倒置）。
  const criticalAtPct = (() => { const v = Number(process.env.SHARE_CRITICAL_BATTERY_PCT); const c = Number.isFinite(v) && v >= 1 ? Math.round(v) : 5; return Math.max(1, Math.min(c, warnAtPct - 1)) })()
  /// 我的"已接受"联系人（双向，排除黑名单双方）——位置可见性的授权集合。单点口径见 store.acceptedContactIds。
  const contactIds = (me: string): string[] => [...acceptedContactIds(store, me)]

  /// 共享位置期间电量跌破阈值 → 通知**本就能看其位置的**已接受亲友（不增新暴露，同到达围栏口径）。
  /// 只在跌破那一刻提醒一次（滞回 + 会话态去重）；缺电量读数不改变状态。best-effort，绝不阻断位置上报。
  function checkLowBattery(me: string, battery: number | undefined): void {
    try {
      const decision = decideLowBatteryWarn(lowBatteryLevel.get(me) ?? 0, battery, warnAtPct, clearAtPct, criticalAtPct)
      lowBatteryLevel.set(me, decision.warnedLevel)
      if (!decision.fired) return
      const sender = store.findById(me)
      if (!sender || battery == null) return
      const pct = Math.round(battery)
      const critical = decision.fired === 'critical'
      const kind = critical ? 'contact_critical_battery' : 'contact_low_battery'
      for (const contactId of acceptedContactIds(store, me)) {
        const l = pushLang(store.findById(contactId)?.language)
        const title = critical ? pushStrings.contactCriticalBatteryTitle(sender.displayName, l) : pushStrings.contactLowBatteryTitle(sender.displayName, l)
        const body = critical ? pushStrings.contactCriticalBatteryBody(sender.displayName, pct, l) : pushStrings.contactLowBatteryBody(sender.displayName, pct, l)
        notifyUser(store, push, contactId, kind, title, body, { fromId: me, battery: String(pct) })
      }
    } catch { /* 低电量预警失败绝不阻断位置上报 */ }
  }

  /// 到达/离开围栏判定 + 通知（best-effort，绝不阻断位置上报）：盲人到达或离开已存坐标的"家/公司"时，
  /// 通知**正在能看其共享位置的家人**（= accepted 联系人，本就能看，故提醒不增加新暴露、只是更省心）。
  /// 只在"外→内"（到达）/"内→外"（离开）转换时提醒（滞回 + 去重）；无坐标地点跳过。
  function checkGeofences(me: string, lat: number, lng: number): void {
    try {
      const places = store.savedPlacesForUser(me).filter((p) => p.lat != null && p.lng != null)
      if (places.length === 0) return
      // **会话首个更新只建立基线、不触发**（含 /stop 清后重开）：首更新分不清"刚到达/刚离开"与"早已在此/在外"，
      // 若在此触发会在每次重开共享（人已在家）时误报（复审#3）。真到达/离开=会话内"外↔内"转换。
      const firstOfSession = !geofence.has(me)
      const { arrived, departed, insideLabels } = evaluateGeofences({ lat, lon: lng }, places, geofence.get(me))
      geofence.set(me, insideLabels)
      if (firstOfSession || (arrived.length === 0 && departed.length === 0)) return
      const sender = store.findById(me)
      if (!sender) return
      // 到达 / 离开共用同一投递（对等）：kind + 对应文案，广播给每个已接受联系人（各自语言）。
      const notify = (place: { label: string }, kind: 'place_arrival' | 'place_departure',
                      titleFn: (n: string, lb: string, l: ReturnType<typeof pushLang>) => string,
                      bodyFn: (n: string, lb: string, l: ReturnType<typeof pushLang>) => string) => {
        for (const contactId of acceptedContactIds(store, me)) {
          const l = pushLang(store.findById(contactId)?.language)
          notifyUser(store, push, contactId, kind,
            titleFn(sender.displayName, place.label, l), bodyFn(sender.displayName, place.label, l),
            { fromId: me, label: place.label })
        }
      }
      for (const place of arrived) notify(place, 'place_arrival', pushStrings.placeArrivalTitle, pushStrings.placeArrivalBody)
      for (const place of departed) notify(place, 'place_departure', pushStrings.placeDepartureTitle, pushStrings.placeDepartureBody)
    } catch { /* 围栏判定/通知失败绝不阻断位置上报 */ }
  }

  // 上报当前位置 + （重）激活共享。客户端在共享期间周期调用（如每 10s）。限流防刷。
  app.post('/api/locations/update', {
    preHandler: [requireAuth(), requireFeature(store, 'locationSharing')],
    config: { rateLimit: { max: 40, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const now = Date.now()
    const me = req.user!.sub
    // 本次更新**之前**是否仍在共享：false=本次是首开、或**TTL 自然过期后重开**（App 切后台/被杀/断网是最常见的
    // 会话结束方式，远多于显式 /stop）。此时清掉可能残留的跨会话围栏/低电量态，让本次首更新只重建基线——否则
    // 隔几小时在别处重开共享会误报一条"离开家"给家人（假恐慌），且未充电就重开会漏报低电量（假安心）。/stop 已清
    // 显式停止这条路径，此处补齐 TTL 过期这条（复审：跨会话陈旧态 #1/#3）。须在 live.update（其会置 isSharing=true）之前判。
    if (!live.isSharing(me, now)) {
      geofence.clear(me)
      lowBatteryLevel.delete(me)
      // 反馈"请求共享"的发起者："X 开始共享了，点击查看"——闭合请求回路（此前请求者只能自己反复刷位置页看对方来没来）。
      // 仅本会话**首更新**（刚从未共享转为共享）时反馈，避免共享期间每次上报都反馈；反馈后清掉请求 key（不重复反馈）。
      // best-effort：反馈失败绝不阻断位置上报本身（notifyUser 内部已全隔离，恒不抛）。
      try {
        const requesters = requestDedup.requestersFor(me, now)
        if (requesters.length) {
          const meUser = store.findById(me)
          const name = meUser?.displayName ?? ''
          for (const rid of requesters) {
            const rl = pushLang(store.findById(rid)?.language)
            notifyUser(store, push, rid, 'location_share_started',
                       pushStrings.locationShareStartedTitle(name || (rl === 'en' ? 'A contact' : '联系人'), rl),
                       pushStrings.locationShareStartedBody(rl), { fromId: me, fromName: name })
            requestDedup.clear(`${rid}:${me}`)
          }
        }
      } catch { /* 反馈请求者失败绝不阻断位置上报 */ }
    }
    const sharingUntil = live.update(me, parsed.data, now, parsed.data.ttlSec ? parsed.data.ttlSec * 1000 : undefined)
    checkGeofences(me, parsed.data.lat, parsed.data.lng) // 到达"家/公司"→ 通知家人（内部 best-effort）
    checkLowBattery(me, parsed.data.battery)             // 电量跌破阈值 → 提醒家人主动联系（内部 best-effort）
    return { ok: true, sharingUntil }
  })

  // 立即停止共享（删除记录；之后联系人查询不再可见）。任何已登录用户可随时停止自己的共享。
  app.post('/api/locations/stop', { preHandler: requireAuth() }, async (req) => {
    live.stop(req.user!.sub)
    geofence.clear(req.user!.sub) // 清围栏基线：下次共享的首更新重建，避免跨会话陈旧态漏报/误报（复审#1/#3）
    lowBatteryLevel.delete(req.user!.sub) // 清低电量会话态：下次共享重新按跌破提醒（充电后重开共享不因陈旧已提醒态而漏报）
    return { ok: true }
  })

  // 拉取：我自己的共享状态 + 我的联系人中**正在共享且新鲜**者的当前位置。
  app.get('/api/locations/contacts', { preHandler: [requireAuth(), requireFeature(store, 'locationSharing')] }, async (req) => {
    const me = req.user!.sub
    const now = Date.now()
    const contacts = contactIds(me)
      .map((id) => {
        const loc = live.visible(id, now) // 仅共享中且新鲜的才返回
        if (!loc) return null
        const u = store.findById(id)
        if (!u) return null
        return {
          userId: id,
          displayName: u.displayName,
          avatar: u.avatar ?? null,
          role: u.role,
          lat: loc.lat,
          lng: loc.lng,
          accuracy: loc.accuracy ?? null,
          heading: loc.heading ?? null,
          battery: loc.battery ?? null,
          updatedAt: loc.updatedAt,
        }
      })
      .filter((c): c is NonNullable<typeof c> => c != null)
    return { sharing: live.isSharing(me, now), sharingUntil: live.sharingUntil(me, now), contacts }
  })

  // 请求对方共享位置（Google Maps 式 nudge）：家人打电话没人接、开始担心 → 一键请求；对方收到可操作
  // 通知后**自行决定**是否开启共享——绝不远程强开（共享永远由本人主动开启，这只是一声请求）。
  // 授权=已接受联系人（acceptedContactIds 双向且排除拉黑双方）；对方已在共享 → 不再打扰（alreadySharing）；
  // 同一对(请求者→目标) 5 分钟内只发一次（内存 TTL 去重，防 nudge 轰炸）；再叠端级限流 6/min。
  const REQUEST_TTL_MS = 5 * 60_000
  const requestDedup = new TtlDedup(REQUEST_TTL_MS) // 有界：陈旧"用户对"条目会被机会式清理，不随累积无限膨胀
  app.post('/api/locations/request', { preHandler: [requireAuth(), requireFeature(store, 'locationSharing')],
                                       config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = z.object({ userId: z.string().min(1).max(64) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const me = req.user!.sub
    if (parsed.data.userId === me) return reply.code(400).send({ error: 'invalid_input' }) // 不能请求自己
    const target = store.findById(parsed.data.userId)
    if (!target || target.status !== 'active') return reply.code(404).send({ error: 'not_found' })
    if (!acceptedContactIds(store, me).has(target.id)) return reply.code(403).send({ error: 'not_linked' }) // 防陌生人骚扰
    const now = Date.now()
    if (live.isSharing(target.id, now)) return { ok: true, alreadySharing: true } // 已在共享（本就可见），不打扰
    const key = `${me}:${target.id}`
    if (!requestDedup.tryPass(key, now)) return { ok: true, deduped: true } // 5 分钟内不重复打扰（放行即记录，去重则不记）
    const meUser = store.findById(me)
    const l = pushLang(target.language)
    // notifyUser 双通道（in-app 持久 + APNs + Web Push），data.fromId/fromName 供客户端渲染"是谁在请求"。
    notifyUser(store, push, target.id, 'location_request',
               pushStrings.locationRequestTitle(meUser?.displayName ?? (l === 'en' ? 'A contact' : '联系人'), l),
               pushStrings.locationRequestBody(l),
               { fromId: me, fromName: meUser?.displayName ?? '' })
    return { ok: true }
  })
}
