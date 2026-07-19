import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth/rbac'
import { lookupProduct, type Macros100g } from '../product/openFoodFacts'

const barcodeRe = /^[0-9]{8,14}$/ // EAN-8 / UPC-A / EAN-13 / ITF-14
const EMPTY_MACROS: Macros100g = { carbohydrates: null, sugars: null, protein: null, fat: null } // notFound 缓存的空占位（各素独立 null）

/// 商品条码 → 商品名（Open Food Facts 代理 + 短期内存缓存）。仅登录用户、限流。
/// 缓存命中与未命中都记（同一条码重复扫不反复打上游、也防被刷慢查询）；重启即清、无需持久化。
export function registerProductRoutes(app: FastifyInstance): void {
  const cache = new Map<string, { name: string | null; allergens: string[]; traces: string[]; nutriScore: string | null; novaGroup: number | null; dietaryLabels: string[]; quantity: string; nutrientLevels: Record<string, string>; ingredients: string; energyKcal100g: number | null; macros100g: Macros100g; servingGrams: number | null; at: number }>()
  const TTL = 24 * 3600_000 // 商品名/标注基本不变，缓存一天
  const MAX = 5000

  app.get('/api/product/:barcode', {
    preHandler: requireAuth(),
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const barcode = (req.params as { barcode: string }).barcode
    if (!barcodeRe.test(barcode)) return reply.code(400).send({ error: 'invalid_barcode' })
    // 界面语言（默认 zh）：决定优先取 OFF 的 product_name_{lang}/ingredients_text_{lang}（进口货的中文专名/配料，
    // 见 openFoodFacts.pickLocalizedText）。**缓存须按 lang 分桶**——同条码不同语言返回不同名字/配料，共用一桶会串味。
    const lang: 'zh' | 'en' = (req.query as { lang?: string })?.lang === 'en' ? 'en' : 'zh'
    const cacheKey = `${barcode}|${lang}`
    const now = Date.now()
    const hit = cache.get(cacheKey)
    if (hit && now - hit.at < TTL) {
      return hit.name ? { name: hit.name, allergens: hit.allergens, traces: hit.traces, nutriScore: hit.nutriScore, novaGroup: hit.novaGroup, dietaryLabels: hit.dietaryLabels, quantity: hit.quantity, nutrientLevels: hit.nutrientLevels, ingredients: hit.ingredients, energyKcal100g: hit.energyKcal100g, macros100g: hit.macros100g, servingGrams: hit.servingGrams } : reply.code(404).send({ error: 'not_found' })
    }
    const outcome = await lookupProduct(barcode, fetch as never, lang)
    // **只缓存确定结果**（found/notFound）；瞬时故障(failed)绝不缓存——否则一次上游抖动使该条码对全体 404 一天，
    // 且 iOS 端用户随后自己起名后永不再回源、过敏原标注永久缺失（复审#5/#10）。failed 返回 503 让客户端下次重试。
    if (outcome.kind === 'failed') return reply.code(503).send({ error: 'lookup_unavailable' })
    if (cache.size >= MAX) { const oldest = cache.keys().next().value; if (oldest !== undefined) cache.delete(oldest) }
    if (outcome.kind === 'found') {
      const { name, allergens, traces, nutriScore, novaGroup, dietaryLabels, quantity, nutrientLevels, ingredients, energyKcal100g, macros100g, servingGrams } = outcome.info
      cache.set(cacheKey, { name, allergens, traces, nutriScore: nutriScore ?? null, novaGroup: novaGroup ?? null, dietaryLabels, quantity, nutrientLevels, ingredients, energyKcal100g: energyKcal100g ?? null, macros100g, servingGrams: servingGrams ?? null, at: now })
      return { name, allergens, traces, nutriScore: nutriScore ?? null, novaGroup: novaGroup ?? null, dietaryLabels, quantity, nutrientLevels, ingredients, energyKcal100g: energyKcal100g ?? null, macros100g, servingGrams: servingGrams ?? null }
    }
    cache.set(cacheKey, { name: null, allergens: [], traces: [], nutriScore: null, novaGroup: null, dietaryLabels: [], quantity: '', nutrientLevels: {}, ingredients: '', energyKcal100g: null, macros100g: EMPTY_MACROS, servingGrams: null, at: now }) // notFound：可长缓存（真未收录短期不会变）
    return reply.code(404).send({ error: 'not_found' })
  })
}
