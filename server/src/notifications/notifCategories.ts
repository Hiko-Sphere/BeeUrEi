import { isAlwaysThrough } from './quietHours'

/// 通知类别静音（纯逻辑，可单测）：把细粒度 kind 归入用户可**按类静音推送横幅**的少数几个软类别。
/// 与勿扰时段正交——**时段**决定何时静、**类别**决定哪类静；两者都只压推送横幅，站内通知照常持久化。
///
/// **安全不变量**：紧急/安全/来电/报到（isAlwaysThrough）一律映射为 null → 永不可被用户静音。
/// 这是纵深防御：即便将来某危急类 kind 新命中了 route/place/friend 子串，isAlwaysThrough 先判会兜住它。

export const MUTABLE_CATEGORIES = ['social', 'route', 'location'] as const
export type NotifCategory = (typeof MUTABLE_CATEGORIES)[number]

/// kind → 可静音类别；不可静音（危急类）或无归属 → null。
/// - route：亲友加/改/删路线（route_added/updated/deleted）
/// - location：到达/离开围栏、共享者低电量（place_arrival/place_departure/battery）
/// - social：好友请求/接受、群成员变更（friend_*/group_*）
/// report/moderation/kyc/medical 等**处置/审核结果**故意不列入（用户不该错过），→ null（不可按类静音）。
export function notifCategory(kind: string): NotifCategory | null {
  if (isAlwaysThrough(kind)) return null // 危急类永不可静音（先判，纵深兜底）
  if (/route/.test(kind)) return 'route'
  if (/place|battery/.test(kind)) return 'location'
  if (/friend|group/.test(kind)) return 'social'
  return null
}

/// 该 kind 的推送横幅是否被用户按类静音。muted 为空/未设 → 一律 false（不静音）。
/// 危急类（notifCategory→null）恒返回 false，绝不因用户静音而漏送。
export function isCategoryMuted(muted: string[] | undefined, kind: string): boolean {
  if (!muted || muted.length === 0) return false
  const cat = notifCategory(kind)
  return cat != null && muted.includes(cat)
}

/// 规整用户提交的静音类别集合：只保留合法类别、去重、稳定序（存储/回传一致）。
export function sanitizeMutedCategories(input: readonly string[]): NotifCategory[] {
  return MUTABLE_CATEGORIES.filter((c) => input.includes(c))
}
