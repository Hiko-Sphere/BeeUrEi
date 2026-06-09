import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { JsonFileStore, type Store } from './db/store'
import { SqliteStore } from './db/sqliteStore'
import { setAuthStore } from './auth/rbac'
import { registerAuthRoutes } from './routes/auth'
import { registerAccountRoutes } from './routes/account'
import { registerUserRoutes } from './routes/users'
import { registerFamilyRoutes } from './routes/family'
import { registerEmergencyRoutes } from './routes/emergency'
import { registerSignaling } from './routes/ws'
import { PresenceRegistry } from './assist/presence'
import { PendingCallRegistry } from './assist/pendingCalls'
import { OpenHelpRegistry } from './assist/openHelp'
import { registerAssistRoutes } from './routes/assist'
import { SignalingHub } from './signaling/hub'
import { registerReportRoutes } from './routes/reports'
import { registerAdminRoutes } from './routes/admin'
import { registerRecordingRoutes } from './routes/recordings'
import { registerDevRoutes } from './routes/dev'
import { registerNavRoutes } from './routes/nav'
import { Metrics } from './metrics/metrics'

export interface AppOptions {
  rateLimitMax?: number
}

/// 构建 Fastify 应用（与 listen 分离，便于用 app.inject() 单测）。
/// 测试传入 MemoryStore；生产/开发默认 SQLite 持久化（见 makeDefaultStore）。
export function buildApp(store: Store = makeDefaultStore(), options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false })
  const hub = new SignalingHub()
  const presence = new PresenceRegistry()
  const pendingCalls = new PendingCallRegistry()
  const openHelp = new OpenHelpRegistry()
  const metrics = new Metrics(Date.now())

  // 监控（D3）：记录每次响应的状态码族，供 /metrics 暴露给 Prometheus。
  app.addHook('onResponse', async (_req, reply) => metrics.observeResponse(reply.statusCode))

  // 速率限制（防暴力/滥用）。必须在路由之前加载，故把 HTTP 路由放进随后加载的子插件，
  // 确保它们继承到限流钩子。
  app.register(rateLimit, { max: options.rateLimitMax ?? 300, timeWindow: '1 minute' })

  app.register(async (instance) => {
    instance.get('/health', async () => ({ status: 'ok', service: 'beeurei-server' }))
    instance.get('/api/version', async () => ({ version: '0.1.0' }))
    // Prometheus 抓取端点（D3）。设了 METRICS_TOKEN 则要求 Bearer 鉴权，否则开放（自托管内网场景）。
    instance.get('/metrics', async (req, reply) => {
      const token = process.env.METRICS_TOKEN
      if (token && req.headers.authorization !== `Bearer ${token}`) {
        return reply.code(401).send('unauthorized\n')
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
    registerAuthRoutes(instance, store)
    registerAccountRoutes(instance, store)
    registerUserRoutes(instance, store)
    registerFamilyRoutes(instance, store)
    registerEmergencyRoutes(instance, store)
    registerReportRoutes(instance, store)
    registerAdminRoutes(instance, store)
    registerRecordingRoutes(instance, store)
    registerDevRoutes(instance, store)
    registerNavRoutes(instance, store)
    registerAssistRoutes(instance, store, hub, presence, pendingCalls, openHelp)
  })

  // WebSocket 信令（自带子插件作用域）。
  registerSignaling(app, hub, store, pendingCalls, openHelp)

  // 统一 404 + 错误兜底（清洁 JSON，不泄露堆栈）。
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }))
  app.setErrorHandler((err, _req, reply) => {
    const e = err as Error & { statusCode?: number }
    const status = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500
    reply.code(status).send({ error: status >= 500 ? 'internal_error' : e.message || 'error' })
  })

  return app
}

/// 默认存储：DB_DRIVER=json 用 JSON 文件，否则用 SQLite（需 --experimental-sqlite）。
export function makeDefaultStore(): Store {
  if (process.env.DB_DRIVER === 'json') {
    return new JsonFileStore(process.env.DB_PATH ?? 'data/db.json')
  }
  return new SqliteStore(process.env.DB_PATH ?? 'data/beeurei.db')
}
