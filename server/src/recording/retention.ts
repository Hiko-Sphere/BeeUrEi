import type { Recording, Store } from '../db/store'
import { removeMediaFile } from '../media/storage'

/// 留存策略（纯逻辑，可单测，见 PLAN §14 Q6）：返回已超过保留期、应删除的录制 id。
export function expiredRecordingIds(list: Recording[], retentionDays: number, now: number): string[] {
  const ms = retentionDays * 86_400_000
  return list.filter((r) => now - r.recordedAt >= ms).map((r) => r.id)
}

/// 清理过期录制：删元数据 + 级联删关联媒体文件与媒体元数据（不留孤儿文件）。返回清理条数。
/// 由 GET /api/recordings（按需）与后台定时器（index.ts，不依赖管理员访问）共同调用。
export function sweepExpiredRecordings(store: Store, now: number): number {
  const cfg = store.getRecordingConfig()
  const expired = expiredRecordingIds(store.allRecordings(), cfg.retentionDays, now)
  for (const id of expired) {
    const rec = store.findRecording(id)
    if (rec?.mediaId) { removeMediaFile(rec.mediaId); store.deleteMedia(rec.mediaId) }
    store.deleteRecording(id)
  }
  return expired.length
}
