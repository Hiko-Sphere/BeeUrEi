import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { amapConfigured, amapGeocode, amapWalking, AmapError } from '../nav/amapClient'

// 坐标校验：从原始字符串校验而非 z.coerce.number()——后者会把空串/空白静默 coerce 成 0，
// 从 (0,0)Null Island 起算路线（看似正常却完全错误，对盲人导航安全攸关，见审查 round5 #2）；
// 也拒绝 'Infinity'/非数字与超出经纬度范围。
const coord = (min: number, max: number) =>
  z.string().trim().min(1).transform(Number)
    .refine(Number.isFinite, 'invalid')
    .refine((v) => v >= min && v <= max, 'out_of_range')
const querySchema = z.object({
  originLat: coord(-90, 90),
  originLon: coord(-180, 180),
  destination: z.string().trim().min(1).optional(),
  // 已知精确目的地坐标（GCJ-02，App 分享位置精确导航）：给了就跳过 geocode 直接路由，绝不再按名字搜（可能命中别处、
  // 把盲人导去错的地方，见复审#8/#9）。二者传其一，destLat/destLon 优先。
  destLat: coord(-90, 90).optional(),
  destLon: coord(-180, 180).optional(),
}).refine((d) => (d.destLat != null && d.destLon != null) || (d.destination != null),
  { message: 'destination_or_coord_required' })

/// 国内步行导航：用高德 Web 服务（key 仅后端持有），App 通过本接口取路线。
export function registerNavRoutes(app: FastifyInstance, store: Store): void {
  // 限流 20/min：本接口每次要打 2 次高德 Web 服务（geocode + walking），而高德是**有额度/计费**的外部上游。
  // 全局 300/min 对它太松（单用户可 600 次高德调用/分钟 → 烧日额度、拖垮全体导航 + 计费）。正常一次导航只取一两条路线。
  app.get('/api/nav/walking', { preHandler: [requireAuth(), requireFeature(store, 'navigation')],
                                config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!amapConfigured()) return reply.code(503).send({ error: 'amap_not_configured' })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })

    const { originLat, originLon, destination, destLat, destLon } = parsed.data
    try {
      // 已知精确坐标 → 直接构造 GCJ-02 "经度,纬度" 目的地串（amapWalking 接受坐标串），跳过 geocode——
      // 聊天分享位置精确导航，绝不再按名字搜命中别处。否则回退按名字 geocode。
      let dest: string
      if (destLat != null && destLon != null) {
        dest = `${destLon},${destLat}`
      } else {
        const geocoded = await amapGeocode(destination!) // refine 已保证二者其一，此处 destination 必有
        if (!geocoded) return reply.code(404).send({ error: 'destination_not_found' }) // 地址确实查不到
        dest = geocoded
      }

      const origin = `${originLon},${originLat}` // 高德为 经度,纬度
      const steps = await amapWalking(origin, dest)
      // 目的地坐标（GCJ-02）拆成数值，供 App 实时引导做到达判定。
      const [dLon, dLat] = dest.split(',').map(Number)
      return {
        destination: dest,
        destinationLat: Number.isFinite(dLat) ? dLat : null,
        destinationLon: Number.isFinite(dLon) ? dLon : null,
        steps,
      }
    } catch (e) {
      // 高德服务侧错误（最常见：AMAP_API_KEY 不是「Web服务」类型 → infocode 10009 USERKEY_PLAT_NOMATCH）。
      // 必须与"目的地未找到"区分：明确返回 amap_error + infocode，让 App 朗读"导航服务暂不可用"而非误导用户改地址。
      // 入服务端日志便于运维定位 key 配置问题。
      if (e instanceof AmapError) {
        req.log?.error?.({ infocode: e.infocode, info: e.info }, '[nav] AMap request failed')
        console.error('[nav] AMap error infocode=%s info=%s (检查 AMAP_API_KEY 是否为「Web服务」类型)', e.infocode, e.info)
        return reply.code(502).send({ error: 'amap_error', infocode: e.infocode, info: e.info })
      }
      console.error('[nav] unexpected error', e)
      return reply.code(502).send({ error: 'nav_unavailable' })
    }
  })
}
