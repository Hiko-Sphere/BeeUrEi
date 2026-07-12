/// 实时共享位置"是否仍在活跃更新"判据（纯函数，单测）。
///
/// 背景：共享端每 ~8s 上报一次（Locations 页 PUBLISH_MS）；服务端 90s（liveLocations.freshMs）无新位置即从
/// 联系人列表剔除。于是列表里的位置至多 90s 旧。但在这 90s 窗口内，若最近一次上报已超过 LIVE_FRESH_MS，
/// 说明对方 App 很可能**已停止上报**（关页/崩溃/断网/没电）——此时仍显示脉动的"实时"绿点是**假实时**，会让
/// 担心的家人误以为位置在持续更新（安全攸关的假安心）。故仅在确属新鲜（≤LIVE_FRESH_MS）时判为 live；否则为
/// "共享中但暂无最新位置"（idle），圆点改为静态弱色、不脉动。相对时间文案（"更新于 X 前"）另行照常显示确切时长。
export const LIVE_FRESH_MS = 45_000 // ≈5–6 个上报周期未见更新即视为暂停（服务端 90s 才剔除，取其半，留足网络抖动余量）

export function isLocationLive(updatedAt: number, now: number): boolean {
  if (!Number.isFinite(updatedAt)) return false // 坏值不冒充"实时"
  return now - updatedAt <= LIVE_FRESH_MS
}

/// 镜像问题（共享者自视）：我的位置上报是否已**持续送达失败**。
/// publish 每 ~8s 一次、单次失败静默重试；若网络断掉，联系人 90s 后就看不到我了，而我的界面仍显示
/// "正在共享"（拉取共享状态的 poll 同样断网失败、无从纠正）——共享者以为家人看得到自己，是反向的假安心。
/// lastOkAt：开始共享时刻为基线、其后每次**成功**上报刷新；null=未在共享。超过 PUBLISH_STALL_MS（≈4 个
/// 上报周期）无成功上报即判定为"送达停滞"，界面如实警示"联系人可能看不到你的最新位置"。
export const PUBLISH_STALL_MS = 30_000

export function isPublishStalled(lastOkAt: number | null, now: number): boolean {
  if (lastOkAt == null || !Number.isFinite(lastOkAt)) return false
  return now - lastOkAt > PUBLISH_STALL_MS
}
