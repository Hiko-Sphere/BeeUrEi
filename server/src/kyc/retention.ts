import type { Store, Verification } from '../db/store'
import { removeKycBlob } from './storage'

/// KYC 留存策略。由后台定时器（index.ts）周期调用，不依赖管理员访问。
///   1) 停滞 pending 超过 30 天 → 自动拒绝（reason=timeout）+ 清除姓名/证件号/图片（防未决证件长期滞留）。
/// **已通过(verified) 记录长期保留证件图/证件号/加密姓名**（运营者选定策略，2026-07-13）——本清扫**不**触碰
/// 已通过记录；管理员可经 admin `/verifications/:id/clear-docs` 随时手动清，或在 拒绝/撤销/撤回/删号 时自动清。
/// legalHold 记录豁免清除（取证）。
export const STALE_PENDING_DAYS = 30

function purgeBlobs(v: Verification): void {
  for (const b of v.blobs ?? []) removeKycBlob(b.blobId)
}

/// 返回清理（自动拒停滞 pending）的记录条数。已通过记录长期保留、不计入。
export function sweepStaleVerifications(store: Store, now: number): number {
  let n = 0
  for (const v of store.allVerifications()) {
    if (v.legalHold) continue // 法务保留豁免
    if (v.status === 'pending' && now - v.submittedAt >= STALE_PENDING_DAYS * 86_400_000) {
      purgeBlobs(v)
      store.decideVerification(v.id, {
        status: 'rejected',
        decidedAt: now,
        decidedBy: 'system',
        rejectReasonCode: 'timeout',
        nameSealed: undefined,
        idNumberSealed: undefined,
        blobs: undefined,
      })
      n++
    }
  }
  return n
}
