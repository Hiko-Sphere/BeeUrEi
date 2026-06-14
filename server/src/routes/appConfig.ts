import type { FastifyInstance } from 'fastify'
import { type Store, effectiveFeatures } from '../db/store'
import { requireAuth } from '../auth/rbac'

/// 客户端读取全站功能开关（登录后）。App 据此隐藏/禁用被关闭功能的入口按钮，
/// 盲人侧点按时朗读"该功能暂时关闭"。这是"控制每一个按键"的客户端落地；
/// 服务端的 requireFeature 仍是硬强制（客户端忽略也拦得住），两者互补。
export function registerAppConfigRoutes(app: FastifyInstance, store: Store): void {
  app.get('/api/app-config', { preHandler: requireAuth() }, async (req) => {
    const cfg = store.getAppConfig()
    const rec = store.getRecordingConfig()
    // 下发**该用户的有效开关**（全站 AND 未被单独关停）——App 据此隐藏按钮，单用户处置自动生效，无需客户端改动。
    const me = req.user ? store.findById(req.user.sub) : undefined
    return {
      features: effectiveFeatures(cfg, me?.featureOverrides),
      registrationEnabled: cfg.registrationEnabled,
      recording: { enabled: rec.enabled, requireConsent: rec.requireConsent },
      announcement: cfg.announcement, // 全站公告横幅（App 顶部展示）
      maintenance: cfg.maintenance,   // 维护模式横幅
      // 刻意不下发 contentFilter.terms：违禁词表仅服务端持有，不泄露给客户端。
    }
  })
}
