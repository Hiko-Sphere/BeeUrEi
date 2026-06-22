import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { JsonFileStore, type Store } from './db/store'
import { SqliteStore } from './db/sqliteStore'
import { setAuthStore } from './auth/rbac'
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
import { registerLocationRoutes } from './routes/locations'
import { LiveLocationRegistry } from './location/liveLocations'
import { registerRecoveryRoutes } from './routes/recovery'
import { registerPushRoutes } from './routes/push'
import { registerAppConfigRoutes } from './routes/appConfig'
import { Metrics } from './metrics/metrics'
import { captureException } from './monitoring/errorReporting'
import { CodeRegistry } from './auth/codes'
import { CodeSendLimiter } from './auth/sendLimiter'
import { ConsoleMailer, type Mailer } from './mail/mailer'
import { NoopPushSender, type PushSender } from './push/apns'
import { createAppleVerifier, type AppleTokenVerifier } from './auth/apple'

export interface AppOptions {
  rateLimitMax?: number
  mailer?: Mailer // 默认 ConsoleMailer（日志打码）；index.ts 可注入 SMTP 邮件器
  pushSender?: PushSender // 默认 Noop（无后台推送）；index.ts 可注入 APNs VoIP 推送（A1）
  // Apple 登录验证器：默认从 APPLE_BUNDLE_ID 环境变量构造（未配置则端点返回 503）；测试注入 fake。
  appleVerifier?: AppleTokenVerifier
  codeSend?: CodeSendLimiter // 验证码发送节流；默认 60s 冷却+窗口上限；测试可注入宽松实例
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
        reply.header('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS')
        reply.header('access-control-allow-headers', (req.headers['access-control-request-headers'] as string) || 'authorization,content-type')
        reply.header('access-control-max-age', '86400')
        return reply.code(204).send()
      }
    } else if (req.method === 'OPTIONS') {
      // 非白名单源的预检：照常回应但**不**带放行头，浏览器据此自行拦截真实请求。
      return reply.code(204).send()
    }
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

  // 业务计数预置 0 基线：使这些 series 自启动起就存在，避免 Prometheus rate() 在首次命中时断档（见复审 #5）。
  for (const name of ['calls_registered_total', 'help_requests_total', 'help_claims_total']) metrics.inc(name, 0)

  // 监控（D3）：记录每次响应的状态码族，供 /metrics 暴露给 Prometheus。
  // 跳过 /metrics 自身——否则每次抓取都会把自己计入 2xx，污染请求量指标（见复审 #4）。
  app.addHook('onResponse', async (req, reply) => {
    if (req.routeOptions?.url === '/metrics') return
    metrics.observeResponse(reply.statusCode)
  })

  // 速率限制（防暴力/滥用）。必须在路由之前加载，故把 HTTP 路由放进随后加载的子插件，
  // 确保它们继承到限流钩子。
  app.register(rateLimit, { max: options.rateLimitMax ?? 300, timeWindow: '1 minute' })

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
    instance.get('/api/version', async () => ({ version: '0.1.0' }))
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
        gauges: { users_total: store.allUsers().length },
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
    registerAuthRoutes(instance, store, codes, mailer, appleVerifier, codeSend)
    registerRecoveryRoutes(instance, store, codes, mailer, codeSend) // 找回密码（D1）
    registerAccountRoutes(instance, store, codes, mailer, appleVerifier, codeSend)
    registerKycRoutes(instance, store) // 实名认证（KYC）：提交/查询（admin 审核端点在 admin 路由）
    registerPasskeyRoutes(instance, store) // Passkey（WebAuthn）注册/登录
    registerPushRoutes(instance, store) // VoIP token 注册（A1）
    registerUserRoutes(instance, store)
    registerFamilyRoutes(instance, store, pushSender)
    registerBlockRoutes(instance, store)
    registerEmergencyRoutes(instance, store, pushSender)
    registerMessageRoutes(instance, store, pushSender)
    registerGroupRoutes(instance, store)
    registerMediaRoutes(instance, store) // 视频等大文件（磁盘存储）
    registerReportRoutes(instance, store)
    registerAdminRoutes(instance, store, presence, hub, callControl, pushSender)
    registerRecordingRoutes(instance, store, recordingConsent, pendingCalls, openHelp)
    registerNotificationRoutes(instance, store) // 站内通知收件箱（举报处理结果等）
    registerDevRoutes(instance, store)
    registerNavRoutes(instance, store)
    registerLocationRoutes(instance, store, liveLocations) // 实时位置共享（亲友/协助者 ↔ 盲人）
    registerAppConfigRoutes(instance, store) // 客户端读取功能开关（控制每一个按键）
    registerAssistRoutes(instance, store, hub, presence, pendingCalls, openHelp, pushSender, metrics)
  })

  // WebSocket 信令（自带子插件作用域）。
  registerSignaling(app, hub, store, pendingCalls, openHelp, callControl)

  // 管理后台 Web 面板（静态 SPA，纯前端、零运行时依赖、与 API 同源）。
  // 服务 server/public/admin → /admin/；用 hash 路由，无需服务端 SPA 回退。
  const publicDir = dirname(fileURLToPath(import.meta.url)) + '/../public'
  app.register(fastifyStatic, { root: join(publicDir, 'admin'), prefix: '/admin/' })
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
