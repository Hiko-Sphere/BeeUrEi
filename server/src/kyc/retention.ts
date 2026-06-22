import type { Store, Verification } from '../db/store'
import { removeKycBlob } from './storage'

/// KYC 留存策略（数据最小化）。由后台定时器（index.ts）周期调用，不依赖管理员访问。
///   1) 停滞 pending 超过 30 天 → 自动拒绝（reason=timeout）+ 清除姓名/证件号/图片（防证件长期滞留）。
///   2) 已通过(verified) 超过 7 天宽限期 → 清除证件图片与证件号，仅保留加密姓名（徽章法律依据）。
/// legalHold 记录豁免清除（取证）。
export const STALE_PENDING_DAYS = 30
export const VERIFIED_GRACE_DAYS = 7

function purgeBlobs(v: Verification): void {
  for (const b of v.blobs ?? []) removeKycBlob(b.blobId)
}

/// 返回清理（自动拒/清证件）的记录条数。
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
    } else if (
      v.status === 'verified' &&
      (v.blobs?.length || v.idNumberSealed) &&
      v.decidedAt != null &&
      now - v.decidedAt >= VERIFIED_GRACE_DAYS * 86_400_000
    ) {
      purgeBlobs(v)
      store.updateVerification(v.id, { idNumberSealed: undefined, blobs: undefined }) // 保留 nameSealed（徽章法律依据）
      n++
    }
  }
  return n
}
