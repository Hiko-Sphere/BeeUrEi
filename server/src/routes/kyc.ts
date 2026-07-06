import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type Verification, type KycBlobRef, type KycDocKind } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { seal, sealField } from '../kyc/crypto'
import { ensureKycDir, writeKycBlob, removeKycBlob } from '../kyc/storage'
import { normalizeImage } from '../kyc/imageNormalize'

/// 单张证件图片上限 8MB（归一化后通常远小于此）。
export const MAX_KYC_IMAGE_BYTES = 8 * 1024 * 1024
const kycImageContentTypes = ['image/jpeg', 'image/png']
const DOC_KINDS: KycDocKind[] = ['front', 'back', 'selfie']

const submitSchema = z.object({
  legalName: z.string().trim().min(1).max(120),
  idType: z.enum(['national_id', 'passport', 'drivers_license', 'residence_permit']),
  idNumberLast4: z.string().trim().regex(/^[0-9A-Za-z]{4}$/), // 明文，非 PII，客服核对/去重用
  idNumber: z.string().trim().min(1).max(64).optional(), // 完整证件号（可选；不填则审核员从证件图片读取）——加密落库
  consentVersion: z.string().trim().min(1).max(16),
})

/// 实名认证（KYC）用户端：提交实名+证件 → 等待管理员人工审核 → 查询状态。
/// 安全：证件号/姓名加密落库；证件图片归一化(剥 EXIF)后 AES-256-GCM 加密落隔离磁盘；
/// 用户**永不**能取回自己提交的证件原图（无任何解密端点对用户开放——仅 admin 审核端点解密且审计）。
export function registerKycRoutes(app: FastifyInstance, store: Store): void {
  // 证件二进制按 Buffer 接收（仅 image/jpeg|png 走此解析器，不影响 JSON 路由；头像走 data URL JSON 不冲突）。
  app.addContentTypeParser(kycImageContentTypes,
    { parseAs: 'buffer', bodyLimit: MAX_KYC_IMAGE_BYTES + 256 * 1024 },
    (_req, body, done) => done(null, body))

  /// 当前实名状态（绝不返回姓名/证件号/图片——仅状态与拒绝原因）。
  app.get('/api/account/verification', { preHandler: requireAuth() }, async (req) => {
    const userId = req.user!.sub
    const active = store.getActiveVerificationForUser(userId)
    const latest = active ?? store.latestVerificationForUser(userId)
    if (!latest) return { status: 'none' as const, canResubmit: true }
    return {
      status: latest.status,
      idType: latest.idType,
      attempt: latest.attempt,
      submittedAt: latest.submittedAt,
      decidedAt: latest.decidedAt,
      rejectReasonCode: latest.status === 'rejected' ? latest.rejectReasonCode : undefined,
      rejectReasonNote: latest.status === 'rejected' ? latest.rejectReasonNote : undefined,
      docsUploaded: (latest.blobs ?? []).map((b) => b.kind),
      canResubmit: latest.status === 'rejected',
    }
  })

  /// 发起一次实名提交（创建 pending 记录，封存姓名/证件号）。随后逐张上传证件图片。
  app.post('/api/account/verification', {
    preHandler: requireAuth(),
    config: { rateLimit: { max: 3, timeWindow: '24 hours' } },
  }, async (req, reply) => {
    const userId = req.user!.sub
    const parsed = submitSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const { legalName, idType, idNumberLast4, idNumber, consentVersion } = parsed.data

    const active = store.getActiveVerificationForUser(userId)
    if (active?.status === 'verified') return reply.code(409).send({ error: 'already_verified' })
    if (active?.status === 'pending') return reply.code(409).send({ error: 'already_pending', id: active.id })

    const id = randomUUID()
    const now = Date.now()
    const prev = store.latestVerificationForUser(userId)
    const v: Verification = {
      id,
      userId,
      status: 'pending',
      idType,
      idLast4: idNumberLast4,
      nameSealed: sealField(legalName, { submissionId: id, kind: 'name' }),
      idNumberSealed: idNumber ? sealField(idNumber, { submissionId: id, kind: 'idNumber' }) : undefined,
      submittedVia: 'self',
      submittedById: userId,
      consentVersion,
      submittedAt: now,
      attempt: (prev?.attempt ?? 0) + 1,
    }
    try {
      store.createVerification(v)
    } catch {
      // 并发双提交撞唯一索引（uniq_verif_active）——回报 409。
      return reply.code(409).send({ error: 'already_pending' })
    }
    return reply.code(201).send({ status: 'pending', id, attempt: v.attempt })
  })

  /// 上传一张证件图片（front/back/selfie）。原始二进制，按 kind 幂等（重传覆盖）。
  app.post('/api/account/verification/:id/doc/:kind', {
    preHandler: requireAuth(),
    bodyLimit: MAX_KYC_IMAGE_BYTES + 256 * 1024,
    config: { rateLimit: { max: 12, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    const userId = req.user!.sub
    const { id, kind } = req.params as { id: string; kind: string }
    if (!DOC_KINDS.includes(kind as KycDocKind)) return reply.code(400).send({ error: 'invalid_kind' })

    const v = store.findVerification(id)
    // 不属于本人/不存在 → 404（不泄漏存在性）；非 pending → 不可再改。
    if (!v || v.userId !== userId) return reply.code(404).send({ error: 'not_found' })
    if (v.status !== 'pending') return reply.code(409).send({ error: 'not_pending' })

    const body = req.body as Buffer | undefined
    if (!body || !Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: 'invalid_input' })
    if (body.length > MAX_KYC_IMAGE_BYTES) return reply.code(413).send({ error: 'image_too_large' })

    // 归一化：magic-byte 嗅探 + 剥离 EXIF/GPS + 校验结构（畸形/非图片→415）。
    let normalized: { buf: Buffer; mime: string }
    try {
      normalized = normalizeImage(body)
    } catch {
      return reply.code(415).send({ error: 'unsupported_or_corrupt_image' })
    }

    // 加密 → 写隔离磁盘。AAD 绑定 submissionId|kind，防密文挪用到别的记录/字段。
    const blobId = randomUUID()
    ensureKycDir()
    const { sealed, ciphertext } = seal(normalized.buf, { submissionId: id, kind })
    await writeKycBlob(blobId, ciphertext)
    const ref: KycBlobRef = { kind: kind as KycDocKind, blobId, sealed, mime: normalized.mime }

    // 覆盖同 kind 的旧图（删旧密文文件）。
    const others = (v.blobs ?? []).filter((b) => b.kind !== kind)
    const old = (v.blobs ?? []).find((b) => b.kind === kind)
    if (old) removeKycBlob(old.blobId)
    store.updateVerification(id, { blobs: [...others, ref] })
    return reply.send({ ok: true, kind, docsUploaded: [...others.map((b) => b.kind), kind] })
  })

  /// 撤回一个尚在 pending 的提交（删密文文件 + 删记录）。
  app.delete('/api/account/verification', { preHandler: requireAuth() }, async (req, reply) => {
    const userId = req.user!.sub
    const active = store.getActiveVerificationForUser(userId)
    if (!active || active.status !== 'pending') return reply.code(404).send({ error: 'no_pending' })
    for (const b of active.blobs ?? []) removeKycBlob(b.blobId)
    store.updateVerification(active.id, { blobs: undefined, nameSealed: undefined, idNumberSealed: undefined })
    store.deleteVerificationsForUser(userId) // 仅删非 legalHold（pending 本不会被 hold）
    return reply.send({ ok: true })
  })
}
