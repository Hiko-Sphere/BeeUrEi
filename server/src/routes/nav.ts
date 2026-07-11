import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { amapConfigured, amapGeocode, amapWalking, amapAround, amapTransit, amapRegeoAdcode, amapReverseGeocode, AmapError } from '../nav/amapClient'

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
      const route = await amapWalking(origin, dest)
      // 目的地坐标（GCJ-02）拆成数值，供 App 实时引导做到达判定。
      const [dLon, dLat] = dest.split(',').map(Number)
      return {
        destination: dest,
        destinationLat: Number.isFinite(dLat) ? dLat : null,
        destinationLon: Number.isFinite(dLon) ? dLon : null,
        steps: route.steps,
        // 全程距离/时长（高德权威值）：App 起步先播"全程约 X 米、步行约 Y 分钟"，盲人据此决定走不走/改公交。
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
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

  // 周边 POI（「周围有什么」国内数据源）：国内 Apple Maps POI 覆盖稀疏，改用高德 place/around 拿密集中文地点，
  // App 端按时钟方位播报。lat/lon 由 App 传 **GCJ-02**（与步行导航同约定：App 已把用户 WGS-84 位置转 GCJ-02）。
  const aroundSchema = z.object({
    lat: coord(-90, 90),
    lon: coord(-180, 180),
    radius: z.string().trim().transform(Number).refine(Number.isFinite, 'invalid')
      .refine((v) => v >= 50 && v <= 3000, 'out_of_range').optional(), // 50m..3km，缺省 250
    keywords: z.string().trim().max(40).optional(), // 可选定向检索（如"卫生间"）
  })
  app.get('/api/nav/around', { preHandler: [requireAuth(), requireFeature(store, 'navigation')],
                               config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!amapConfigured()) return reply.code(503).send({ error: 'amap_not_configured' })
    const parsed = aroundSchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const { lat, lon, radius, keywords } = parsed.data
    const r = radius ?? 250
    try {
      const pois = await amapAround(`${lon},${lat}`, r, keywords) // 高德序：经度,纬度（GCJ-02）
      return { radius: r, pois }
    } catch (e) {
      if (e instanceof AmapError) {
        req.log?.error?.({ infocode: e.infocode, info: e.info }, '[nav/around] AMap request failed')
        console.error('[nav/around] AMap error infocode=%s info=%s', e.infocode, e.info)
        return reply.code(502).send({ error: 'amap_error', infocode: e.infocode, info: e.info })
      }
      console.error('[nav/around] unexpected error', e)
      return reply.code(502).send({ error: 'nav_unavailable' })
    }
  })

  // 逆地理编码「我在哪」（国内数据源）：境内 Apple CLGeocoder 中文地址粒度粗、门牌常缺，改用高德 regeo
  // 拿准确街道门牌 + 最近地标绝对方位——盲人可据此向出租车/路人/家人精确转述所在（BlindSquare/Soundscape 的
  // "My Location" 刚需）。lat/lon 由 App 传 **GCJ-02**（与 around/walking 同约定：App 已转好）。
  const whereamiSchema = z.object({ lat: coord(-90, 90), lon: coord(-180, 180) })
  app.get('/api/nav/whereami', { preHandler: [requireAuth(), requireFeature(store, 'navigation')],
                                 config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!amapConfigured()) return reply.code(503).send({ error: 'amap_not_configured' })
    const parsed = whereamiSchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const { lat, lon } = parsed.data
    try {
      const result = await amapReverseGeocode(`${lon},${lat}`) // 高德序：经度,纬度（GCJ-02）
      if (!result) return reply.code(404).send({ error: 'address_not_found' }) // 高德无结果（海上/极偏）→ App 回退 Apple
      return result
    } catch (e) {
      if (e instanceof AmapError) {
        req.log?.error?.({ infocode: e.infocode, info: e.info }, '[nav/whereami] AMap request failed')
        console.error('[nav/whereami] AMap error infocode=%s info=%s', e.infocode, e.info)
        return reply.code(502).send({ error: 'amap_error', infocode: e.infocode, info: e.info })
      }
      console.error('[nav/whereami] unexpected error', e)
      return reply.code(502).send({ error: 'nav_unavailable' })
    }
  })

  // 公交/地铁路径规划（跨城市出行的关键——步行导航只能覆盖短途，盲人过城全靠公共交通）。
  // 目的地传名字（服务端 geocode）或已知 GCJ-02 坐标（destLat/destLon）；起点城市由服务端对 origin 逆地理编码取 adcode。
  const transitSchema = z.object({
    originLat: coord(-90, 90),
    originLon: coord(-180, 180),
    destination: z.string().trim().min(1).optional(),
    destLat: coord(-90, 90).optional(),
    destLon: coord(-180, 180).optional(),
  }).refine((d) => (d.destLat != null && d.destLon != null) || (d.destination != null),
    { message: 'destination_or_coord_required' })
  app.get('/api/nav/transit', { preHandler: [requireAuth(), requireFeature(store, 'navigation')],
                                config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!amapConfigured()) return reply.code(503).send({ error: 'amap_not_configured' })
    const parsed = transitSchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const { originLat, originLon, destination, destLat, destLon } = parsed.data
    const origin = `${originLon},${originLat}` // 高德序：经度,纬度（GCJ-02）
    try {
      let dest: string
      if (destLat != null && destLon != null) {
        dest = `${destLon},${destLat}`
      } else {
        const geocoded = await amapGeocode(destination!) // refine 已保证二者其一
        if (!geocoded) return reply.code(404).send({ error: 'destination_not_found' })
        dest = geocoded
      }
      const city = await amapRegeoAdcode(origin) // 公交 API 的 city 必填：起点行政区 adcode
      if (!city) return reply.code(502).send({ error: 'city_unresolved' }) // 逆地理无 adcode（极少）→ 无法规划公交
      const plan = await amapTransit(origin, dest, city)
      if (!plan) return reply.code(404).send({ error: 'no_transit_route' }) // 太近应步行/无公交覆盖/跨城无直达
      return plan
    } catch (e) {
      if (e instanceof AmapError) {
        req.log?.error?.({ infocode: e.infocode, info: e.info }, '[nav/transit] AMap request failed')
        console.error('[nav/transit] AMap error infocode=%s info=%s', e.infocode, e.info)
        return reply.code(502).send({ error: 'amap_error', infocode: e.infocode, info: e.info })
      }
      console.error('[nav/transit] unexpected error', e)
      return reply.code(502).send({ error: 'nav_unavailable' })
    }
  })
}
