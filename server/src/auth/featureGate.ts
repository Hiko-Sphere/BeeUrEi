import type { FastifyRequest, FastifyReply } from 'fastify'
import { type Store, type FeatureKey, effectiveFeatures } from '../db/store'

/// preHandler 工厂：要求某项功能对**当前用户**有效。运行在 requireAuth 之后（req.user 已就绪）。
/// 维护模式优先：开启时所有功能写操作返回 503 maintenance（带维护文案），App 显示维护横幅。
/// 否则按"全站开关 AND 该用户未被单独关停"判定；关闭时 403 feature_disabled。
/// 这是"管理员能真正控制每个功能（全站 + 单用户）"的强制层：客户端忽略 /api/app-config 也拦得住。
export function requireFeature(store: Store, feature: FeatureKey) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const cfg = store.getAppConfig()
    if (cfg.maintenance.active) {
      reply.code(503).send({ error: 'maintenance', message: cfg.maintenance.message })
      return reply
    }
    const user = req.user ? store.findById(req.user.sub) : undefined
    if (!effectiveFeatures(cfg, user?.featureOverrides)[feature]) {
      reply.code(403).send({ error: 'feature_disabled', feature })
      return reply
    }
  }
}
