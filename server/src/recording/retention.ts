import type { Recording } from '../db/store'

/// 留存策略（纯逻辑，可单测，见 PLAN §14 Q6）：返回已超过保留期、应删除的录制 id。
export function expiredRecordingIds(list: Recording[], retentionDays: number, now: number): string[] {
  const ms = retentionDays * 86_400_000
  return list.filter((r) => now - r.recordedAt >= ms).map((r) => r.id)
}
