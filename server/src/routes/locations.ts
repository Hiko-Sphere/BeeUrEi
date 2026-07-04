import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store, acceptedContactIds } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { type LiveLocationRegistry } from '../location/liveLocations'
import { evaluateGeofences } from '../location/geofence'
import { type PushSender, NoopPushSender } from '../push/apns'
import { pushLang, pushStrings } from '../push/pushStrings'
import { notifyUser } from '../notifications/notify'

/// 到达围栏状态（纯内存，userId → 当前"在内"的地点 label 集合）：作下次判定的 prevInside。
/// 重启即清（重启后首个更新可能重复提示一次到达，可接受）；规模化可换 Redis。同 PresenceRegistry 惯例。
class GeofenceState {
  private map = new Map<string, Set<string>>()
  get(userId: string): Set<string> { return this.map.get(userId) ?? new Set() }
  set(userId: string, labels: string[]): void {
    if (labels.length === 0) this.map.delete(userId)
    else this.map.set(userId, new Set(labels))
  }
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
  /// 我的"已接受"联系人（双向，排除黑名单双方）——位置可见性的授权集合。单点口径见 store.acceptedContactIds。
  const contactIds = (me: string): string[] => [...acceptedContactIds(store, me)]

  /// 到达围栏判定 + 通知（best-effort，绝不阻断位置上报）：盲人到达已存坐标的"家/公司"时，
  /// 通知**正在能看其共享位置的家人**（= accepted 联系人，本就能看，故到达提醒不增加新暴露、只是更省心）。
  /// 只在"外→内"转换时提醒（滞回 + 去重）；无坐标地点跳过。
  function checkGeofences(me: string, lat: number, lng: number): void {
    try {
      const places = store.savedPlacesForUser(me).filter((p) => p.lat != null && p.lng != null)
      if (places.length === 0) return
      const { arrived, insideLabels } = evaluateGeofences({ lat, lon: lng }, places, geofence.get(me))
      geofence.set(me, insideLabels)
      if (arrived.length === 0) return
      const sender = store.findById(me)
      if (!sender) return
      for (const place of arrived) {
        for (const contactId of acceptedContactIds(store, me)) {
          const l = pushLang(store.findById(contactId)?.language)
          notifyUser(store, push, contactId, 'place_arrival',
            pushStrings.placeArrivalTitle(sender.displayName, place.label, l),
            pushStrings.placeArrivalBody(sender.displayName, place.label, l),
            { fromId: me, label: place.label })
        }
      }
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
    const sharingUntil = live.update(me, parsed.data, now, parsed.data.ttlSec ? parsed.data.ttlSec * 1000 : undefined)
    checkGeofences(me, parsed.data.lat, parsed.data.lng) // 到达"家/公司"→ 通知家人（内部 best-effort）
    return { ok: true, sharingUntil }
  })

  // 立即停止共享（删除记录；之后联系人查询不再可见）。任何已登录用户可随时停止自己的共享。
  app.post('/api/locations/stop', { preHandler: requireAuth() }, async (req) => {
    live.stop(req.user!.sub)
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
}
