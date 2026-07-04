import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store, acceptedContactIds } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { type LiveLocationRegistry } from '../location/liveLocations'

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
export function registerLocationRoutes(app: FastifyInstance, store: Store, live: LiveLocationRegistry): void {
  /// 我的"已接受"联系人（双向，排除黑名单双方）——位置可见性的授权集合。单点口径见 store.acceptedContactIds。
  const contactIds = (me: string): string[] => [...acceptedContactIds(store, me)]

  // 上报当前位置 + （重）激活共享。客户端在共享期间周期调用（如每 10s）。限流防刷。
  app.post('/api/locations/update', {
    preHandler: [requireAuth(), requireFeature(store, 'locationSharing')],
    config: { rateLimit: { max: 40, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const now = Date.now()
    const sharingUntil = live.update(req.user!.sub, parsed.data, now, parsed.data.ttlSec ? parsed.data.ttlSec * 1000 : undefined)
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
