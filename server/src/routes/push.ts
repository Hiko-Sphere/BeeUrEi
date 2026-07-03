import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { type WebPushSender } from '../push/webPush'

// VoIP token 必须是十六进制（PushKit token = 32 字节 = 64 hex）。严格限制字符集，
// 防止用户可控值带非法字符注入 APNs 的 :path（/3/device/<token>），见复审 #8。
const tokenSchema = z.object({ voipToken: z.string().regex(/^[0-9a-fA-F]{64,200}$/) })
// 普通 APNs token 同为十六进制（注入防护同 VoIP，见复审 #8）。
const apnsTokenSchema = z.object({ token: z.string().regex(/^[0-9a-fA-F]{64,200}$/) })

/// PushKit VoIP token 注册（A1 后台来电）。客户端拿到 token 后上报，发呼叫时据此推送。
// Web Push 订阅体：endpoint 须为浏览器推送服务的 https URL；keys 为 base64url（长度设上限防滥用存储）。
const webSubSchema = z.object({
  endpoint: z.string().url().startsWith('https://').max(1024),
  keys: z.object({
    p256dh: z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+$/),
    auth: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
  }),
})
const webUnsubSchema = z.object({ endpoint: z.string().url().max(1024) })
// 轮换：旧订阅三元组（endpoint+双 key）即所有权凭证——SW 上下文无 auth token，而这三元组
// 只有该浏览器与服务端持有（高熵能力值，off-path 不可猜）。
const webRotateSchema = z.object({
  old: z.object({ endpoint: z.string().url().max(1024), p256dh: z.string().min(16).max(256), auth: z.string().min(8).max(128) }),
  sub: webSubSchema,
})

export function registerPushRoutes(app: FastifyInstance, store: Store, webPush?: WebPushSender): void {
  app.post('/api/push/register', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = tokenSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    store.clearVoipTokenFromOthers(parsed.data.voipToken, req.user!.sub) // 设备换账号：从旧账号收回此 token，防跨账号来电推送
    store.updateUser(req.user!.sub, { voipToken: parsed.data.voipToken })
    return { ok: true }
  })

  // 注销（退出登录/关闭来电时调用，停止后续推送到该设备）。
  app.delete('/api/push/register', { preHandler: requireAuth() }, async (req) => {
    store.updateUser(req.user!.sub, { voipToken: undefined })
    return { ok: true }
  })

  // 普通 APNs token 注册（软件外提醒推送：好友请求/被接受等）。
  app.post('/api/push/apns-register', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = apnsTokenSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    store.clearApnsTokenFromOthers(parsed.data.token, req.user!.sub) // 设备换账号：从旧账号收回此 token，防跨账号提醒推送泄漏
    store.updateUser(req.user!.sub, { apnsToken: parsed.data.token })
    return { ok: true }
  })
  app.delete('/api/push/apns-register', { preHandler: requireAuth() }, async (req) => {
    store.updateUser(req.user!.sub, { apnsToken: undefined })
    return { ok: true }
  })

  // ---- Web Push（浏览器推送，web-only 协助者关标签页也能收紧急告警）----
  // 客户端订阅前先取 VAPID 公钥；未配置（NoopWebPushSender）诚实 503——不收下永远不会被推送的订阅。
  app.get('/api/push/web-vapid-key', { preHandler: requireAuth() }, async (_req, reply) => {
    if (!webPush?.configured || !process.env.VAPID_PUBLIC_KEY) return reply.code(503).send({ error: 'web_push_not_configured' })
    return { key: process.env.VAPID_PUBLIC_KEY }
  })

  app.post('/api/push/web-subscribe', { preHandler: requireAuth(),
                                        config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!webPush?.configured) return reply.code(503).send({ error: 'web_push_not_configured' })
    const parsed = webSubSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    // 浏览器换账号登录：endpoint 是浏览器级的，从旧账号收回，防跨账号告警泄漏（同 APNs token 口径）。
    store.clearWebPushSubscriptionFromOthers(parsed.data.endpoint, req.user!.sub)
    store.upsertWebPushSubscription({ endpoint: parsed.data.endpoint, userId: req.user!.sub,
      p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, createdAt: Date.now() })
    // 每用户订阅总量上限（默认 8，WEB_PUSH_MAX_PER_USER 可调）：subscribe 限流只限速率不限存量——
    // 伪造 endpoint 无限囤积会让每条通知放大成 N 次推送（费时+可作三方轰炸跳板）。超限**驱逐最旧**
    // 而非拒绝：换浏览器/清站点数据是正常 churn，最新订阅才是活跃浏览器；旧的多半已是死订阅。
    const maxSubs = (() => { const v = Number(process.env.WEB_PUSH_MAX_PER_USER); return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 8 })()
    const mine = store.webPushSubscriptionsForUser(req.user!.sub).sort((a, b) => a.createdAt - b.createdAt)
    for (const stale of mine.slice(0, Math.max(0, mine.length - maxSubs))) {
      store.deleteWebPushSubscription(stale.endpoint)
    }
    return { ok: true }
  })

  // 订阅轮换（SW pushsubscriptionchange）：浏览器主动更换订阅时 SW 无 auth token——用**旧订阅
  // 三元组**证明所有权换新（行业模式：endpoint+keys 是仅浏览器与服务端持有的高熵能力值）。
  // 三元组全比对（不只 endpoint）：拿到过期 endpoint 的旁路者无法劫持轮换把推送引到自己浏览器。
  // 失败一律 404 不区分原因（不当存在性 oracle）。限流按 IP（无 sub 可依）。
  app.post('/api/push/web-rotate', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!webPush?.configured) return reply.code(503).send({ error: 'web_push_not_configured' })
    const parsed = webRotateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const cur = store.findWebPushSubscription(parsed.data.old.endpoint)
    if (!cur || cur.p256dh !== parsed.data.old.p256dh || cur.auth !== parsed.data.old.auth) {
      return reply.code(404).send({ error: 'not_found' })
    }
    store.deleteWebPushSubscription(cur.endpoint)
    store.upsertWebPushSubscription({ endpoint: parsed.data.sub.endpoint, userId: cur.userId,
      p256dh: parsed.data.sub.keys.p256dh, auth: parsed.data.sub.keys.auth, createdAt: Date.now() })
    return { ok: true }
  })

  // 自测推送：把一条测试通知发到**本人**的全部浏览器订阅——运营者配完 VAPID、用户开完开关，
  // 一键验证端到端真通（订阅存在≠推送能到：VAPID 配错/浏览器厂商侧失败只有真发一次才知道）。
  app.post('/api/push/web-test', { preHandler: requireAuth(),
                                   config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!webPush?.configured) return reply.code(503).send({ error: 'web_push_not_configured' })
    const subs = store.webPushSubscriptionsForUser(req.user!.sub)
    if (subs.length === 0) return reply.code(404).send({ error: 'no_subscription' })
    const payload = JSON.stringify({ title: 'BeeUrEi', body: '测试通知 / Test notification', data: { kind: 'push_test' } })
    const results = await Promise.allSettled(subs.map((sub) => webPush.send(sub, payload)))
    const sent = results.filter((r) => r.status === 'fulfilled').length
    return { ok: true, sent, total: subs.length } // sent<total 时客户端提示部分失败
  })

  app.delete('/api/push/web-subscribe', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = webUnsubSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    // 只能删自己的订阅（endpoint 不属于本人则无操作——不泄露他人订阅存在性）。
    const mine = store.webPushSubscriptionsForUser(req.user!.sub).some((s2) => s2.endpoint === parsed.data.endpoint)
    if (mine) store.deleteWebPushSubscription(parsed.data.endpoint)
    return { ok: true }
  })
}
