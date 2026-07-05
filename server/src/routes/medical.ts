import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store, isBlockedBetween } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { sealField, openField, type Sealed } from '../kyc/crypto'
import { type PushSender, NoopPushSender } from '../push/apns'
import { pushLang, pushStrings } from '../push/pushStrings'
import { notifyUser } from '../notifications/notify'

/// 紧急医疗信息（Apple Medical ID / Life360 式）：本人填写关键健康信息（血型/过敏/用药/病史/紧急备注），
/// 供其**指定的紧急亲友**在遇险时了解、辅助施救。
///
/// 隐私设计（GDPR Art.9 特殊类别健康数据）：
/// - **明确 opt-in**：默认空；本人主动填写即知情同意"供紧急联系人在紧急时查看"（前端随文案提示）。
/// - **加密落库**：AES-256-GCM 信封（复用 KYC 主密钥，AAD 绑 userId——密文不可挪用到别人的记录）；DB 泄露不可解。
/// - **收件范围最小**：仅 accepted **isEmergency** 亲友可读（比 Apple Medical ID 的"任何施救者"更严）；不进任何公开/推送正文
///   （避免锁屏/日志暴露），亲友在**响应时按需拉取**。
/// - 删号级联清除；本人可随时清空。
const AAD_KIND = 'medical_info'
const putSchema = z.object({ text: z.string().max(4000) }) // 空串=清除

export function registerMedicalRoutes(app: FastifyInstance, store: Store, push: PushSender = new NoopPushSender()): void {
  const aadFor = (userId: string) => ({ submissionId: userId, kind: AAD_KIND })
  // 访问透明去重：同一(查看者:被查看者)10 分钟内只通知本人一次——避免施救者刷新/多次拉取轰炸遇险者的通知。
  const viewNotified = new Map<string, number>()
  const VIEW_DEDUP_MS = 10 * 60_000

  /// 解密某用户的医疗信息明文；无记录/解密失败返回 undefined（fail-closed，绝不吐半解密/错误内容）。
  const decrypt = (userId: string): { text: string; updatedAt: number } | undefined => {
    const rec = store.getMedicalInfo(userId)
    if (!rec) return undefined
    try {
      const sealed = JSON.parse(rec.sealed) as Sealed
      return { text: openField(sealed, aadFor(userId)), updatedAt: rec.updatedAt }
    } catch { return undefined } // 密文损坏/密钥不符：当作无信息，不泄漏错误细节
  }

  // 本人查看自己的医疗信息。
  app.get('/api/account/medical', { preHandler: requireAuth() }, async (req) => {
    const m = decrypt(req.user!.sub)
    return { medicalInfo: m?.text ?? '', updatedAt: m?.updatedAt ?? null }
  })

  // 本人填写/更新（空串=清除）。加密后落库。
  app.put('/api/account/medical', { preHandler: requireAuth(),
                                    config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = putSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const me = req.user!.sub
    const text = parsed.data.text.trim()
    if (text === '') { store.deleteMedicalInfoForUser(me); return { ok: true, cleared: true } }
    const sealed = sealField(text, aadFor(me))
    store.setMedicalInfo({ userId: me, sealed: JSON.stringify(sealed), updatedAt: Date.now() })
    return { ok: true }
  })

  // 紧急亲友查看某用户的医疗信息：仅 accepted **isEmergency** 亲友可读（遇险响应时按需拉取）。
  app.get('/api/family/:userId/medical', { preHandler: requireAuth() }, async (req, reply) => {
    const targetId = (req.params as { userId: string }).userId
    const me = req.user!.sub
    if (targetId === me) { const m = decrypt(me); return { medicalInfo: m?.text ?? '', updatedAt: m?.updatedAt ?? null } }
    // 授权：me 必须是 target 的**已接受紧急亲友**（target 是 owner、me 是被标 isEmergency 的 member）。
    const isEmergencyContact = store.linksByOwner(targetId)
      .some((l) => (l.status ?? 'accepted') === 'accepted' && l.memberId === me && l.isEmergency)
    // 拉黑即撤回访问：拉黑不删链、不清 isEmergency——若不额外查 isBlockedBetween，被本人拉黑的旧紧急联系人
    // 仍能拉取其血型/过敏/用药等健康 PII（GDPR Art.9 特殊类别数据泄漏给已被明确切断关系的人）。与全站
    // 可达性双查铁律（areLinked∧!isBlockedBetween）同口径；拉黑与非联系人回同一 403，不做存在性 oracle。
    if (!isEmergencyContact || isBlockedBetween(store, me, targetId)) return reply.code(403).send({ error: 'not_emergency_contact' })
    const m = decrypt(targetId)
    if (!m) return reply.code(404).send({ error: 'no_medical_info' }) // 对方未填：诚实告知无信息（非泄漏存在性——已过授权）
    const target = store.findById(targetId)
    // 访问透明/问责（GDPR Art.9 健康数据）：真被查看即通知本人"X 查看了你的医疗信息"（对标"新登录提醒"）。
    // 去重 10 分钟（刷新/多次拉取不轰炸）；信息类通知（走 notifyUser，遵守勿扰，非告警）。best-effort，不阻断读取。
    const now = Date.now()
    const key = `${me}:${targetId}`
    const last = viewNotified.get(key)
    if (last === undefined || now - last >= VIEW_DEDUP_MS) {
      viewNotified.set(key, now)
      if (viewNotified.size > 5000) for (const [k, t] of viewNotified) if (now - t >= VIEW_DEDUP_MS) viewNotified.delete(k) // 有界清理
      const viewer = store.findById(me)
      if (viewer) {
        const l = pushLang(target?.language)
        notifyUser(store, push, targetId, 'medical_info_viewed',
          pushStrings.medicalInfoViewedTitle(viewer.displayName, l),
          pushStrings.medicalInfoViewedBody(viewer.displayName, l),
          { viewerId: me, viewerName: viewer.displayName })
      }
    }
    return { medicalInfo: m.text, fromName: target?.displayName ?? '', updatedAt: m.updatedAt }
  })
}
