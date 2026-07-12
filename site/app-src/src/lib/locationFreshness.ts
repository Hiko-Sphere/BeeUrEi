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
