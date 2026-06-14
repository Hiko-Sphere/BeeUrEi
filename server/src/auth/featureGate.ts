import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Store, FeatureKey } from '../db/store'

/// preHandler 工厂：要求某项全站功能开关为开。
/// 维护模式优先：开启时所有功能写操作返回 503 maintenance（带维护文案），App 显示维护横幅。
/// 否则功能被关时返回 403 feature_disabled（带 feature 名），客户端提示"该功能暂时关闭"。
/// 这是"管理员能真正控制每个功能"的强制层：即使客户端忽略 /api/app-config，被关功能的写操作也会在服务端被拒。
export function requireFeature(store: Store, feature: FeatureKey) {
  return async (_req: FastifyRequest, reply: FastifyReply) => {
    const cfg = store.getAppConfig()
    if (cfg.maintenance.active) {
      reply.code(503).send({ error: 'maintenance', message: cfg.maintenance.message })
      return reply
    }
    if (!cfg.features[feature]) {
      reply.code(403).send({ error: 'feature_disabled', feature })
      return reply
    }
  }
}
