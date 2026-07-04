import Fastify, { type FastifyInstance } from 'fastify'
import { PKG_VERSION, gitCommit } from './version'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { JsonFileStore, type Store } from './db/store'
import { SqliteStore } from './db/sqliteStore'
import { setAuthStore } from './auth/rbac'
import { verifyAccessToken } from './auth/tokens'
import { registerAuthRoutes } from './routes/auth'
import { registerAccountRoutes } from './routes/account'
import { registerKycRoutes } from './routes/kyc'
import { registerPasskeyRoutes } from './routes/passkey'
import { registerUserRoutes } from './routes/users'
import { registerFamilyRoutes } from './routes/family'
import { registerBlockRoutes } from './routes/blocks'
import { registerEmergencyRoutes } from './routes/emergency'
import { registerMessageRoutes } from './routes/messages'
import { registerGroupRoutes } from './routes/groups'
import { registerMediaRoutes } from './routes/media'
import { registerSignaling } from './routes/ws'
import { CallControlBridge } from './signaling/callControl'
import { PresenceRegistry } from './assist/presence'
import { PendingCallRegistry } from './assist/pendingCalls'
import { OpenHelpRegistry } from './assist/openHelp'
import { registerAssistRoutes } from './routes/assist'
import { SignalingHub } from './signaling/hub'
import { registerReportRoutes } from './routes/reports'
import { registerAdminRoutes } from './routes/admin'
import { registerRecordingRoutes } from './routes/recordings'
import { registerNotificationRoutes } from './routes/notifications'
import { RecordingConsentRegistry } from './recording/consentRegistry'
import { registerDevRoutes } from './routes/dev'
import { registerNavRoutes } from './routes/nav'
import { registerVisionRoutes } from './routes/vision'
import { registerProductRoutes } from './routes/product'
import { registerLocationRoutes } from './routes/locations'
import { registerSavedRouteRoutes } from './routes/savedRoutes'
import { registerSavedPlaceRoutes } from './routes/savedPlaces'
import { registerSafetyRoutes } from './routes/safety'
import { LiveLocationRegistry } from './location/liveLocations'
import { registerRecoveryRoutes } from './routes/recovery'
import { registerPushRoutes } from './routes/push'
import { registerAppConfigRoutes } from './routes/appConfig'
import { Metrics } from './metrics/metrics'
import { captureException } from './monitoring/errorReporting'
import { CodeRegistry } from './auth/codes'
import { CodeSendLimiter } from './auth/sendLimiter'
import { LoginThrottle } from './auth/loginThrottle'
import { ConsoleMailer, type Mailer } from './mail/mailer'
import { NoopPushSender, type PushSender } from './push/apns'
import { CountingWebPushSender, NoopWebPushSender, type WebPushSender } from './push/webPush'
import { setNotifyWebPush } from './notifications/notify'
import { setAmapMetrics } from './nav/amapClient'
import { createAppleVerifier, type AppleTokenVerifier } from './auth/apple'

export interface AppOptions {
  rateLimitMax?: number
  mailer?: Mailer // 默认 ConsoleMailer（日志打码）；index.ts 可注入 SMTP 邮件器
  pushSender?: PushSender // 默认 Noop（无后台推送）；index.ts 可注入 APNs VoIP 推送（A1）
  webPushSender?: WebPushSender // 默认 Noop；index.ts 配 VAPID_* 后注入真实浏览器推送（web 告警）
  // Apple 登录验证器：默认从 APPLE_BUNDLE_ID 环境变量构造（未配置则端点返回 503）；测试注入 fake。
  appleVerifier?: AppleTokenVerifier
  codeSend?: CodeSendLimiter // 验证码发送节流；默认 60s 冷却+窗口上限；测试可注入宽松实例
  loginThrottle?: LoginThrottle // 按账号登录节流（NIST 800-63B）；测试可注入短延迟实例
}

/// 构建 Fastify 应用（与 listen 分离，便于用 app.inject() 单测）。
/// 测试传入 MemoryStore；生产/开发默认 SQLite 持久化（见 makeDefaultStore）。
export function buildApp(store: Store = makeDefaultStore(), options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false })

  // CORS：协助者/亲友网页端在 beeurei.hikosphere.com，跨源调用本 API（beeurei-api.hikosphere.com）。
  // 仅放行白名单源（默认官网域 + 本地开发），按请求回显具体 Origin（绝不用 '*'）。鉴权走 Bearer 头（非 Cookie），
  // 故无需 allow-credentials。WebSocket(/ws) 握手不受 CORS 限制；<video>/<img> 跨源媒体亦无需 CORS。
  const corsOrigins = new Set(
    (process.env.CORS_ORIGINS ?? 'https://beeurei.hikosphere.com')
      .split(',').map((s) => s.trim()).filter(Boolean),
  )
  corsOrigins.add('http://localhost:5173')
  corsOrigins.add('http://127.0.0.1:5173')
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin
    if (origin && corsOrigins.has(origin)) {
      reply.header('access-control-allow-origin', origin)
      reply.header('vary', 'Origin')
      if (req.method === 'OPTIONS') {
        reply.header('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS') // 含 PATCH：API 有 PATCH 端点(admin 改资料)，列表应覆盖全部支持方法(已含同为 admin-only 的 PUT)
        reply.header('access-control-allow-headers', (req.headers['access-control-request-headers'] as string) || 'authorization,content-type')
        reply.header('access-control-max-age', '86400')
        return reply.code(204).send()
      }
    } else if (req.method === 'OPTIONS') {
      // 非白名单源的预检：照常回应但**不**带放行头，浏览器据此自行拦截真实请求。
      return reply.code(204).send()
    }
  })

  // 安全响应头（纵深防御，对所有实际响应生效）：
  // - nosniff：禁 MIME 嗅探——防把媒体/JSON 被浏览器改判为 HTML/脚本执行（媒体流的存储型 XSS 兜底）。
  // - X-Frame-Options DENY：防点击劫持——尤其 /admin 后台 HTML 不得被恶意站点 iframe。
  // - Referrer-Policy：跨站只发来源、不泄完整路径。
  // 全局 CSP/HSTS 刻意不在此设：任意响应的 CSP 需按页精调（易误伤 SPA），HSTS 应在 TLS 终止的反代层设。
  //   （例外：自包含的 /admin 后台单独发 header CSP，见下方 fastifyStatic 注册处。）
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    // Cache-Control: no-store —— 仅对 /api/* 响应。这些几乎全部携带令牌(登录/注册/刷新)或 PII
    // (用户资料/亲友含手机号/通知/整库备份)，绝不应被浏览器 bfcache 或中间代理缓存（OWASP 敏感数据
    // 缓存弱点）。默认 Fastify 不设 Cache-Control → 落到启发式缓存，故显式关闭。
    // **只 gate /api/**：静态资源(/admin 后台、官网)保持可缓存不受影响；本 app 无任何 /api 端点从
    // 浏览器/代理缓存获益（version/metrics/health 皆无所谓，其余皆敏感）。处理器可再覆写（媒体端点
    // 已显式设 private,no-store，与此兼容）。
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
  })

  const hub = new SignalingHub()
  const presence = new PresenceRegistry()
  const pendingCalls = new PendingCallRegistry()
  const openHelp = new OpenHelpRegistry()
  const liveLocations = new LiveLocationRegistry() // 实时位置共享（纯内存，不落库）
  const callControl = new CallControlBridge() // 管理员 REST → 通话房间（强制结束等）；由信令层填实现
  // 两类会话(定向亲友呼叫 / 公开求助)共享 callId 字符串空间。互相做跨表去重，
  // 防止任意用户用同名 callId 在另一表抢注、影子覆盖参与权、窃听/锁出他人通话（见审查 #1/#7）。
  pendingCalls.setConflictCheck((id, now) => openHelp.hasActive(id, now))
  openHelp.setConflictCheck((id, now) => pendingCalls.hasActive(id, now))
  const metrics = new Metrics(Date.now())
  const codes = new CodeRegistry()
  const recordingConsent = new RecordingConsentRegistry() // 录制知情同意（服务端权威）
  const codeSend = options.codeSend ?? new CodeSendLimiter() // 发送侧节流：同一收件人 60s 冷却 + 窗口上限（防连点/邮件轰炸）
  const mailer = options.mailer ?? new ConsoleMailer()
  const pushSender = options.pushSender ?? new NoopPushSender()
  // 计数包裹须在 metrics 构造之后——见下方 webPushSender 最终定型处。
  const rawWebPushSender = options.webPushSender ?? new NoopWebPushSender()

  // 业务计数预置 0 基线：使这些 series 自启动起就存在，避免 Prometheus rate() 在首次命中时断档（见复审 #5）。
  for (const name of ['calls_registered_total', 'help_requests_total', 'help_claims_total', 'emergency_alerts_total',
                      'web_push_sent_total', 'web_push_failed_total',
                      'apns_sent_total', 'apns_failed_total',
                      'vision_describe_total', 'vision_quota_exceeded_total', 'vision_errors_total',
                      'amap_calls_total', 'amap_timeouts_total', 'amap_errors_total', 'amap_upstream_errors_total',
                      'amap_breaker_open_total', 'amap_breaker_rejected_total']) metrics.inc(name, 0)
  setAmapMetrics((name) => metrics.inc(name)) // 高德外部依赖可观测性（限额/计费，监控量/超时/网络/上游错误）
  // Web Push 计数装饰（单点包裹，扇出调用点零改动）：送达健康度进 /metrics。
  // APNs 送达健康度：挂钩注入（接口契约"绝不抛出"，外层装饰器观察不到失败——见 apns.ts onOutcome）。
  pushSender.onOutcome = (ok) => metrics.inc(ok ? 'apns_sent_total' : 'apns_failed_total')
  const webPushSender: WebPushSender = new CountingWebPushSender(rawWebPushSender, (n) => metrics.inc(n))
  setNotifyWebPush(webPushSender) // notifyUser 统一投递的 Web Push 通道（模块单例，见 notify.ts）——包裹后注入，计数覆盖该路

  // 监控（D3）：记录每次响应的状态码族，供 /metrics 暴露给 Prometheus。
  // 跳过 /metrics 自身——否则每次抓取都会把自己计入 2xx，污染请求量指标（见复审 #4）。
  app.addHook('onResponse', async (req, reply) => {
    if (req.routeOptions?.url === '/metrics') return
    metrics.observeResponse(reply.statusCode)
  })

  // 速率限制（防暴力/滥用）。必须在路由之前加载，故把 HTTP 路由放进随后加载的子插件，
  // 确保它们继承到限流钩子。
  // keyGenerator：已登录请求按**用户(sub)**限流，未登录（登录/注册等）回落到 IP。
  //   ·比纯按 IP 更准：不受运营商 NAT 共享 IP 误伤、也不受反代把源 IP 收敛成一个的影响
  //    （若 API 在反代后又未配 trustProxy，纯 IP 限流会退化成全站共用一个桶——见部署待办）；
  //    且用户无法靠换 IP 放大自己的额度（authed 滥用限流如加好友/改邮箱因此真正生效）。
  //   ·无绕过面：token 验不过（verifyAccessToken 返回 null，绝不抛）即回落 IP，伪造 token 无效。
  app.register(rateLimit, {
    max: options.rateLimitMax ?? 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const authz = req.headers.authorization
      if (authz && authz.startsWith('Bearer ')) {
        const claims = verifyAccessToken(authz.slice(7))
        if (claims?.sub) return `u:${claims.sub}`
      }
      return req.ip
    },
  })

  app.register(async (instance) => {
    instance.get('/health', async () => ({ status: 'ok', service: 'beeurei-server' }))
    // Apple 关联域文件（passkey/webcredentials）：iOS 据此把本 App 与 PASSKEY_RP_ID 域关联。
    // 必须是 application/json、无重定向。App 前缀 = TeamID.BundleID。
    instance.get('/.well-known/apple-app-site-association', async (_req, reply) => {
      const teamId = process.env.APPLE_TEAM_ID?.trim() || '7CDDP73WJS'
      const bundleId = process.env.APPLE_BUNDLE_ID?.trim() || 'com.beeurei.BeeUrEi'
      reply.type('application/json')
      return { webcredentials: { apps: [`${teamId}.${bundleId}`] } }
    })
    // 版本探针（部署验证）：version 读自 package.json（单一真相），commit 由 Docker build-arg 注入
    // GIT_SHA（未注入=本地开发 → 'unknown'）。运维据此确认线上跑的是哪个提交，而非猜。
    instance.get('/api/version', async () => ({ version: PKG_VERSION, commit: gitCommit() }))
    // Prometheus 抓取端点（D3）。设了 METRICS_TOKEN 则要求 Bearer 鉴权，否则开放（自托管内网场景）。
    instance.get('/metrics', async (req, reply) => {
      // trim：避免误写 METRICS_TOKEN=（空白）被当作 falsy 而静默关闭鉴权（见审查 #14）。
      const token = process.env.METRICS_TOKEN?.trim()
      if (token && !constantTimeEqual(req.headers.authorization ?? '', `Bearer ${token}`)) {
        return reply.code(401).send('unauthorized\n') // 常量时间比较防计时侧信道（见审查 #15）
      }
      reply.type('text/plain; version=0.0.4; charset=utf-8')
      return metrics.render({
        nowMs: Date.now(),
        gauges: { users_total: store.userCount() },
      })
    })
    // 就绪探针：触达存储确认可用（供监控/编排健康检查）。
    instance.get('/api/ready', async () => {
      store.getRecordingConfig()
      return { ready: true }
    })
    setAuthStore(store) // 让 requireAuth 能实时校验账号状态/tokenVersion（见审查 #1/#2）
    const bundleId = process.env.APPLE_BUNDLE_ID?.trim()
    const appleVerifier = options.appleVerifier ?? (bundleId ? createAppleVerifier(bundleId) : undefined)
    registerAuthRoutes(instance, store, codes, mailer, appleVerifier, codeSend, options.loginThrottle)
    registerRecoveryRoutes(instance, store, codes, mailer, codeSend) // 找回密码（D1）
    registerAccountRoutes(instance, store, codes, mailer, appleVerifier, codeSend)
    registerKycRoutes(instance, store) // 实名认证（KYC）：提交/查询（admin 审核端点在 admin 路由）
    registerPasskeyRoutes(instance, store) // Passkey（WebAuthn）注册/登录
    registerPushRoutes(instance, store, webPushSender) // VoIP token 注册（A1）
    registerUserRoutes(instance, store)
    registerFamilyRoutes(instance, store, pushSender)
    registerBlockRoutes(instance, store)
    registerEmergencyRoutes(instance, store, presence, liveLocations, pushSender, webPushSender, metrics)
    registerMessageRoutes(instance, store, pushSender, webPushSender)
    registerGroupRoutes(instance, store, pushSender)
    registerMediaRoutes(instance, store) // 视频等大文件（磁盘存储）
    registerReportRoutes(instance, store)
    registerAdminRoutes(instance, store, presence, hub, callControl, pushSender)
    registerRecordingRoutes(instance, store, recordingConsent, pendingCalls, openHelp)
    registerNotificationRoutes(instance, store) // 站内通知收件箱（举报处理结果等）
    registerDevRoutes(instance, store)
    registerNavRoutes(instance, store)
    registerVisionRoutes(instance, store, metrics) // AI 场景描述/图像问答（云端视觉大模型，provider 无关，未配 VISION_* 则 503）
    registerProductRoutes(instance) // 商品条码→商品名（Open Food Facts 代理，免密钥）
    registerLocationRoutes(instance, store, liveLocations, pushSender) // 实时位置共享 + 到达围栏提醒（亲友 ↔ 盲人）
    registerSavedRouteRoutes(instance, store, pushSender) // 路线库（亲友远程路线编排 + 盲人自存路线）
    registerSavedPlaceRoutes(instance, store) // 保存的地点（家/公司/自定义，快捷导航）
    registerSafetyRoutes(instance, store, pushSender, webPushSender) // 安全报到计时器（到期未确认平安 → 后台自动告警亲友；/complete 报平安复用 all-clear）
    registerAppConfigRoutes(instance, store) // 客户端读取功能开关（控制每一个按键）
    registerAssistRoutes(instance, store, hub, presence, pendingCalls, openHelp, pushSender, metrics, webPushSender)
  })

  // WebSocket 信令（自带子插件作用域）。
  registerSignaling(app, hub, store, pendingCalls, openHelp, callControl)

  // 管理后台 Web 面板（静态 SPA，纯前端、零运行时依赖、与 API 同源）。
  // 服务 server/public/admin → /admin/；用 hash 路由，无需服务端 SPA 回退。
  const publicDir = dirname(fileURLToPath(import.meta.url)) + '/../public'
  // /admin 后台 CSP **作为响应头**交付（严格强于 index.html 内的 <meta http-equiv> CSP）：
  // ① meta 交付的 CSP 会被浏览器忽略 frame-ancestors/sandbox（点击劫持须靠头），且只覆盖 HTML
  //    本身、不覆盖 app.js/styles.css 响应；② 注入若发生在 meta 标签之前则不受约束。
  // 策略与面板内 meta 逐字一致（自包含 SPA、零外链、与 API 同源，故对已在生产运行的面板零破坏），
  // 额外补 frame-ancestors 'none'（点击劫持的现代等价，belt-and-suspenders 于已设的 X-Frame-Options）
  // 与 object-src 'none'（面板不用任何插件）。这是"CSP 应按页精调"的一个例外：面板自包含，策略明确。
  const ADMIN_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
    + "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'"
  app.register(fastifyStatic, {
    root: join(publicDir, 'admin'),
    prefix: '/admin/',
    setHeaders: (res) => { res.setHeader('Content-Security-Policy', ADMIN_CSP) },
  })
  app.get('/admin', async (_req, reply) => reply.redirect('/admin/', 301))
  // 法律文件已迁至官网同源页面 https://beeurei.hikosphere.com/legal/（不再托管于 API 域）。
  // 旧链接 301 永久重定向过去，避免外部/历史引用失效；上架隐私政策 URL 请直接填官网地址。
  const LEGAL_URL = 'https://beeurei.hikosphere.com/legal/'
  app.get('/legal', async (_req, reply) => reply.redirect(LEGAL_URL, 301))
  app.get('/legal/', async (_req, reply) => reply.redirect(LEGAL_URL, 301))

  // 统一 404 + 错误兜底（清洁 JSON，不泄露堆栈）。
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }))
  app.setErrorHandler((err, _req, reply) => {
    const e = err as Error & { statusCode?: number }
    const status = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500
    if (status >= 500) captureException(err) // 仅服务端故障上报 Sentry（D3/F2），4xx 业务错误不上报
    reply.code(status).send({ error: status >= 500 ? 'internal_error' : e.message || 'error' })
  })

  return app
}

/// 常量时间字符串比较（防计时侧信道，见审查 #15）。长度不等直接判否。
function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/// 默认存储：DB_DRIVER=json 用 JSON 文件，否则用 SQLite（需 --experimental-sqlite）。
export function makeDefaultStore(): Store {
  if (process.env.DB_DRIVER === 'json') {
    return new JsonFileStore(process.env.DB_PATH ?? 'data/db.json')
  }
  return new SqliteStore(process.env.DB_PATH ?? 'data/beeurei.db')
}
