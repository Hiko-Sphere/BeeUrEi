import type { FastifyInstance } from 'fastify'
import { type Store, effectiveFeatures } from '../db/store'
import { requireAuth } from '../auth/rbac'

/// 当前隐私政策/使用条款版本（LEGAL_VERSION，默认 '1'）：客户端据此与**用户已同意版本**(selfView.legalConsentVersion)
/// 比对，不一致 → 请其重新查看并同意。版本号是运营者约定的短字符串（如 '1'/'2024-06'）：条款有实质变更时递增，
/// 触发全体重新同意（GDPR 第 7 条"可证明 + 可更新的同意"）。坏/空值回落 '1'。
export function currentLegalVersion(env: string | undefined = process.env.LEGAL_VERSION): string {
  const v = (env ?? '').trim()
  return v.length > 0 && v.length <= 16 ? v : '1'
}

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
      requireVerification: cfg.requireVerification, // 是否要求实名认证（客户端据此对未认证用户显示门禁屏）
      legalVersion: currentLegalVersion(), // 当前条款版本：客户端比对用户已同意版本，不一致则请其重新同意
      // 刻意不下发 contentFilter.terms：违禁词表仅服务端持有，不泄露给客户端。
    }
  })
}
