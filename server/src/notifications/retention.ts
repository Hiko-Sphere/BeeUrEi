import type { Store } from '../db/store'

/// 站内通知留存清扫（数据最小化）：通知此前**无限增长**——每次呼叫/消息/好友请求/告警都写一条
/// 持久通知，而读取只取最近 100 条，老通知是纯死重 + PII 留存负担（含发起人 id/显示名/坐标等）。
/// 与录音/KYC/孤儿媒体同口径：由 index.ts 后台定时器每小时调用。
///
/// 保留期默认 90 天（NOTIF_RETENTION_DAYS 可调，须为 ≥1 的有限数，坏值回落默认）。
/// 不区分已读/未读：90 天未读的通知同样已失去时效（呼叫早已结束、告警早已处置），统一口径最简单
/// 且可预期；紧急告警的可追溯性由管理员审计日志与通话记录承担，不靠站内通知长存。
export const DEFAULT_NOTIF_RETENTION_DAYS = 90

export function notifRetentionDays(env: string | undefined = process.env.NOTIF_RETENTION_DAYS): number {
  const d = Number(env)
  return Number.isFinite(d) && d >= 1 ? d : DEFAULT_NOTIF_RETENTION_DAYS
}

/// 删除早于保留期的通知，返回清理条数。
export function sweepOldNotifications(store: Store, now: number, retentionDays: number = notifRetentionDays()): number {
  return store.deleteNotificationsOlderThan(now - retentionDays * 86_400_000)
}
