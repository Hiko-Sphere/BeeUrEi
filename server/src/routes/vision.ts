import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { visionConfigured, visionDescribe, VisionError } from '../vision/visionClient'

/// 单张图片解码上限 5MB（约 4–6MP JPEG，足够场景描述；更大只是徒增上游 token 成本与延迟）。
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/// 每用户每日成功调用上限（默认 200，VISION_DAILY_MAX 可调，≥1）：限流(10/min)只限**速率**不限**当日总量**，
/// 而视觉大模型是**外部付费**额度——单账号持续 10/min 一天可打 1.4 万次烧光运维预算。每日配额是付费 AI 功能的
/// 行业标配（软上限，跨 UTC 日自动重置）。仅成功调用计入，失败不烧配额（失败的速率已由 10/min 限流兜住）。
export function visionDailyMax(env: string | undefined = process.env.VISION_DAILY_MAX): number {
  const n = Number(env ?? '200')
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 200
}

/// 当前 UTC 日期 yyyy-mm-dd（每日配额分桶键）。
function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

const bodySchema = z.object({
  image: z.string().min(1),                        // base64（可带或不带 data: 前缀，见下方剥离）
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  question: z.string().trim().max(300).optional(), // 可选：图像问答
  lang: z.enum(['zh', 'en']).optional(),
})

/// AI 场景描述 / 图像问答（云端视觉大模型；provider 无关，见 visionClient）。
/// 未配置 VISION_* → 503 ai_not_configured（fail-closed，绝不假装成功、绝无罐头回复）。
export function registerVisionRoutes(app: FastifyInstance, store: Store): void {
  // 限流 10/min：每次都打一次**有额度/计费**的视觉大模型（比高德更贵更慢）。全局 300/min 太松。
  // bodyLimit：base64 会膨胀 ~33%，5MB 图 → ~6.8MB JSON，留足余量到 8MB。
  app.post('/api/vision/describe', {
    preHandler: [requireAuth(), requireFeature(store, 'aiDescribe')],
    bodyLimit: 8 * 1024 * 1024,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!visionConfigured()) return reply.code(503).send({ error: 'ai_not_configured' })
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const { mime, question, lang } = parsed.data

    // 容错：客户端可能连 data: 前缀一起发来，剥离后取纯 base64；再去掉可能的空白。
    const b64 = parsed.data.image.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return reply.code(400).send({ error: 'invalid_input' })
    // 解码后大小校验（防超大图烧 token/拖慢）。base64 长度 * 3/4 ≈ 字节数。
    const approxBytes = Math.floor(b64.length * 3 / 4)
    if (approxBytes > MAX_IMAGE_BYTES) return reply.code(413).send({ error: 'image_too_large' })

    // 每日配额（护外部付费额度；见 visionDailyMax）：当日已达上限即 429，绝不再打上游。
    const day = utcDay()
    if (store.visionCallsOnDay(req.user!.sub, day) >= visionDailyMax()) {
      return reply.code(429).send({ error: 'ai_daily_quota_exceeded' })
    }

    try {
      const text = await visionDescribe({
        imageDataUrl: `data:${mime};base64,${b64}`,
        question,
        lang: lang ?? 'zh',
      })
      store.recordVisionCall(req.user!.sub, day) // 仅成功计入配额（失败不烧用户额度，失败速率已由 10/min 限流兜住）
      return { text }
    } catch (e) {
      // 不外泄上游细节/密钥；仅入服务端日志便于运维定位（如 VISION_* 配置错误、上游 4xx/5xx）。
      if (e instanceof VisionError) {
        console.error('[vision] describe failed status=%s detail=%s', e.status, e.detail)
        return reply.code(502).send({ error: 'ai_error' })
      }
      console.error('[vision] unexpected error', e)
      return reply.code(502).send({ error: 'ai_unavailable' })
    }
  })
}
