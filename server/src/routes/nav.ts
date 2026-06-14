import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { amapConfigured, amapGeocode, amapWalking } from '../nav/amapClient'

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
  destination: z.string().trim().min(1),
})

/// 国内步行导航：用高德 Web 服务（key 仅后端持有），App 通过本接口取路线。
export function registerNavRoutes(app: FastifyInstance, store: Store): void {
  app.get('/api/nav/walking', { preHandler: [requireAuth(), requireFeature(store, 'navigation')] }, async (req, reply) => {
    if (!amapConfigured()) return reply.code(503).send({ error: 'amap_not_configured' })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })

    const { originLat, originLon, destination } = parsed.data
    const dest = await amapGeocode(destination)
    if (!dest) return reply.code(404).send({ error: 'destination_not_found' })

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
  })
}
