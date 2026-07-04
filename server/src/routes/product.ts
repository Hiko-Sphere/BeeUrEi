import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth/rbac'
import { lookupProduct } from '../product/openFoodFacts'

const barcodeRe = /^[0-9]{8,14}$/ // EAN-8 / UPC-A / EAN-13 / ITF-14

/// 商品条码 → 商品名（Open Food Facts 代理 + 短期内存缓存）。仅登录用户、限流。
/// 缓存命中与未命中都记（同一条码重复扫不反复打上游、也防被刷慢查询）；重启即清、无需持久化。
export function registerProductRoutes(app: FastifyInstance): void {
  const cache = new Map<string, { name: string | null; allergens: string[]; at: number }>()
  const TTL = 24 * 3600_000 // 商品名/标注基本不变，缓存一天
  const MAX = 5000

  app.get('/api/product/:barcode', {
    preHandler: requireAuth(),
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const barcode = (req.params as { barcode: string }).barcode
    if (!barcodeRe.test(barcode)) return reply.code(400).send({ error: 'invalid_barcode' })
    const now = Date.now()
    const hit = cache.get(barcode)
    if (hit && now - hit.at < TTL) {
      return hit.name ? { name: hit.name, allergens: hit.allergens } : reply.code(404).send({ error: 'not_found' })
    }
    const info = await lookupProduct(barcode, fetch as never)
    if (cache.size >= MAX) { const oldest = cache.keys().next().value; if (oldest !== undefined) cache.delete(oldest) }
    cache.set(barcode, { name: info?.name ?? null, allergens: info?.allergens ?? [], at: now })
    return info ? { name: info.name, allergens: info.allergens } : reply.code(404).send({ error: 'not_found' })
  })
}
