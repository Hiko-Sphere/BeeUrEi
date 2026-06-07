import Fastify, { type FastifyInstance } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { JsonFileStore, type Store } from './db/store'
import { SqliteStore } from './db/sqliteStore'
import { registerAuthRoutes } from './routes/auth'
import { registerUserRoutes } from './routes/users'
import { registerFamilyRoutes } from './routes/family'
import { registerEmergencyRoutes } from './routes/emergency'
import { registerSignaling } from './routes/ws'
import { SignalingHub } from './signaling/hub'
import { registerReportRoutes } from './routes/reports'
import { registerAdminRoutes } from './routes/admin'
import { registerRecordingRoutes } from './routes/recordings'
import { registerDevRoutes } from './routes/dev'
import { registerNavRoutes } from './routes/nav'

export interface AppOptions {
  rateLimitMax?: number
}

/// 构建 Fastify 应用（与 listen 分离，便于用 app.inject() 单测）。
/// 测试传入 MemoryStore；生产/开发默认 SQLite 持久化（见 makeDefaultStore）。
export function buildApp(store: Store = makeDefaultStore(), options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false })

  // 速率限制（防暴力/滥用）。必须在路由之前加载，故把 HTTP 路由放进随后加载的子插件，
  // 确保它们继承到限流钩子。
  app.register(rateLimit, { max: options.rateLimitMax ?? 300, timeWindow: '1 minute' })

  app.register(async (instance) => {
    instance.get('/health', async () => ({ status: 'ok', service: 'beeurei-server' }))
    instance.get('/api/version', async () => ({ version: '0.1.0' }))
    registerAuthRoutes(instance, store)
    registerUserRoutes(instance, store)
    registerFamilyRoutes(instance, store)
    registerEmergencyRoutes(instance, store)
    registerReportRoutes(instance, store)
    registerAdminRoutes(instance, store)
    registerRecordingRoutes(instance, store)
    registerDevRoutes(instance, store)
    registerNavRoutes(instance, store)
  })

  // WebSocket 信令（自带子插件作用域）。
  registerSignaling(app, new SignalingHub())

  return app
}

/// 默认存储：DB_DRIVER=json 用 JSON 文件，否则用 SQLite（需 --experimental-sqlite）。
export function makeDefaultStore(): Store {
  if (process.env.DB_DRIVER === 'json') {
    return new JsonFileStore(process.env.DB_PATH ?? 'data/db.json')
  }
  return new SqliteStore(process.env.DB_PATH ?? 'data/beeurei.db')
}
