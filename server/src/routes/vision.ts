import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { visionConfigured, visionDescribe, VisionError } from '../vision/visionClient'
import type { Metrics } from '../metrics/metrics'

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
  // 可选：同一张图的**追问历史**（对标 Be My AI 连续追问）。上限 8 轮防上下文/token 膨胀；每轮 q/a 有界。
  history: z.array(z.object({ q: z.string().trim().max(300), a: z.string().trim().max(4000) })).max(8).optional(),
  lang: z.enum(['zh', 'en']).optional(),
})

/// AI 场景描述 / 图像问答（云端视觉大模型；provider 无关，见 visionClient）。
/// 未配置 VISION_* → 503 ai_not_configured（fail-closed，绝不假装成功、绝无罐头回复）。
export function registerVisionRoutes(app: FastifyInstance, store: Store, metrics?: Metrics): void {
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
    const { mime, question, history, lang } = parsed.data

    // 容错：客户端可能连 data: 前缀一起发来，剥离后取纯 base64；再去掉可能的空白。
    const b64 = parsed.data.image.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return reply.code(400).send({ error: 'invalid_input' })
    // 解码后大小校验（防超大图烧 token/拖慢）。base64 长度 * 3/4 ≈ 字节数。
    const approxBytes = Math.floor(b64.length * 3 / 4)
    if (approxBytes > MAX_IMAGE_BYTES) return reply.code(413).send({ error: 'image_too_large' })

    // 每日配额（护外部付费额度；见 visionDailyMax）：当日已达上限即 429，绝不再打上游。
    const day = utcDay()
    const dailyMax = store.getAppConfig().visionDailyMax ?? visionDailyMax() // 配置优先(管理员实时可调)，未设则跟随 env/默认
    const sub = req.user!.sub
    // 检查 + **预留**须原子：两次同步 store 调用间无 await，故并发请求不会都在自增前通过检查（此前 record 在 await
    // **之后**才自增——边界处 N 个并发全过检查、齐打上游、齐自增，可越配额多打 ~限流并发数(10) 次付费调用，
    // 部分抵消配额护预算的目的）。改为"先占额(reserve)、上游失败再退还(refund)"：check+record 相邻同步 → 原子占额；
    // 语义仍"仅成功计入"（失败 refund 归还，见 catch）。
    if (store.visionCallsOnDay(sub, day) >= dailyMax) {
      metrics?.inc('vision_quota_exceeded_total') // 值守：单账号撞每日上限的速率（异常飙升=滥用/配额过紧）
      // 回带 remaining/dailyMax：客户端可明确告知盲人"今日 AI 描述已用完（0/N），次日 UTC 0 点重置"，而非笼统报错。
      return reply.code(429).send({ error: 'ai_daily_quota_exceeded', remaining: 0, dailyMax })
    }
    store.recordVisionCall(sub, day) // 原子占额（与上面的检查相邻、其间无 await）：并发的下一个请求必看到本次占用而被挡

    try {
      const text = await visionDescribe({
        imageDataUrl: `data:${mime};base64,${b64}`,
        question,
        history, // 追问历史（连续图像问答的上下文）；无=单轮
        lang: lang ?? 'zh',
      })
      metrics?.inc('vision_describe_total') // 值守：成功描述数≈外部付费调用量（乘单价即成本，可对账/告警）
      // 回带剩余次数：付费额度有限，盲人靠它配给使用（"还剩 N 次"），临近上限时客户端可提前提醒，避免用到一半突然被拒。
      const remaining = Math.max(0, dailyMax - store.visionCallsOnDay(sub, day)) // 含刚占的这次
      return { text, remaining, dailyMax }
    } catch (e) {
      store.refundVisionCall(sub, day) // 上游失败退还预留（保持"失败不烧用户额度"；失败速率已由 10/min 限流兜住）
      // 不外泄上游细节/密钥；仅入服务端日志便于运维定位（如 VISION_* 配置错误、上游 4xx/5xx）。
      metrics?.inc('vision_errors_total') // 值守：上游失败率（飙升=provider 故障/配额耗尽/配置错，可告警）
      if (e instanceof VisionError) {
        console.error('[vision] describe failed status=%s detail=%s', e.status, e.detail)
        // 失败原因存便签供 admin 总览呈现"为什么描述不了"（如 provider 401/配额/VISION_* 配错）——不必翻日志。
        // detail 已由 visionClient 截断(≤200)、不含密钥，透传安全。盲人「描述场景/Be My AI」骨干，挂了运维要一眼可见。
        metrics?.setNote('vision_last_error', `${e.status}: ${e.detail}`, Date.now())
        return reply.code(502).send({ error: 'ai_error' })
      }
      console.error('[vision] unexpected error', e)
      metrics?.setNote('vision_last_error', 'unexpected error', Date.now())
      return reply.code(502).send({ error: 'ai_unavailable' })
    }
  })

  // 只读配额查询：让盲人在**动用一次付费调用之前**就知道"今日 AI 描述还剩几次"（付费/每日封顶功能的行业标配——
  // describe 仅在**成功调用后**才回带 remaining，逼近上限的用户无法提前配给、只能靠撞 429 才知道用完了）。
  // 纯读当日计数：**不打上游、不烧配额**（GET 语义幂等）。与 describe 同口径 fail-closed：未配置 VISION_* → 503
  //（绝不对一个每次调用都会 503 的功能谎报"还剩 N 次"）；同受 aiDescribe 特性开关约束（管理员关停则一并 403）。
  app.get('/api/vision/quota', {
    preHandler: [requireAuth(), requireFeature(store, 'aiDescribe')],
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!visionConfigured()) return reply.code(503).send({ error: 'ai_not_configured' })
    const day = utcDay()
    const dailyMax = store.getAppConfig().visionDailyMax ?? visionDailyMax() // 配置优先(管理员实时可调)，未设则跟随 env/默认
    const calls = store.visionCallsOnDay(req.user!.sub, day)
    // used 夹到 dailyMax：运维把配额调小后旧计数仍在，避免显示成越界的"用了 N/更小上限"（remaining 已 Math.max(0) 兜住不为负）。
    // day 一并回带：客户端可据 UTC 日算出本地"次日 0 点(UTC)重置"的确切时刻，而非笼统说"明天重置"。
    return { used: Math.min(dailyMax, calls), remaining: Math.max(0, dailyMax - calls), dailyMax, day }
  })
}
