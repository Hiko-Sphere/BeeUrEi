import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Store, FeatureKey } from '../db/store'

/// preHandler 工厂：要求某项全站功能开关为开。关闭时统一返回 403 feature_disabled（带 feature 名），
/// 客户端据此提示"该功能暂时关闭"。放在 requireAuth 之后（顺序无关，但语义上先鉴权再判功能）。
/// 这是"管理员能真正控制每个功能"的强制层：即使客户端忽略 /api/app-config，被关功能的写操作也会在服务端被拒。
export function requireFeature(store: Store, feature: FeatureKey) {
  return async (_req: FastifyRequest, reply: FastifyReply) => {
    if (!store.getAppConfig().features[feature]) {
      reply.code(403).send({ error: 'feature_disabled', feature })
      return reply
    }
  }
}
