import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { amapConfigured, amapGeocode, amapWalking } from '../nav/amapClient'

const querySchema = z.object({
  originLat: z.coerce.number(),
  originLon: z.coerce.number(),
  destination: z.string().min(1),
})

/// 国内步行导航：用高德 Web 服务（key 仅后端持有），App 通过本接口取路线。
export function registerNavRoutes(app: FastifyInstance, _store: Store): void {
  app.get('/api/nav/walking', { preHandler: requireAuth() }, async (req, reply) => {
    if (!amapConfigured()) return reply.code(503).send({ error: 'amap_not_configured' })
    const parsed = querySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })

    const { originLat, originLon, destination } = parsed.data
    const dest = await amapGeocode(destination)
    if (!dest) return reply.code(404).send({ error: 'destination_not_found' })

    const origin = `${originLon},${originLat}` // 高德为 经度,纬度
    const steps = await amapWalking(origin, dest)
    return { destination: dest, steps }
  })
}
