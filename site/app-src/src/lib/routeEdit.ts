/// 路线编辑纯逻辑（可单测，与 Leaflet/DOM 无关）。

export interface LatLng { lat: number; lng: number; note?: string }

/// 在路线航点序列里插入一个新点：
/// - 若当前选中了某个**非末尾**航点 → 插到它**之后**（便于给已画好的路线**中段补点**，
///   免得只能追加到末尾再逐格上移——一条 20 点路线在开头补点旧做法要按十几次「上移」）；
/// - 未选中 / 选中的正是末尾点 → 追加到末尾（保持"从起点依次点击画线"的直觉：画线时每次追加后
///   选中的都是末点，故下一次点击仍是追加，行为与旧版逐字一致）。
///
/// 返回新序列与**应选中的新点索引**（=刚插入的位置），供调用方同步高亮/地图。泛型保留 note 等附加字段。
export function insertWaypoint<T extends LatLng>(
  waypoints: readonly T[],
  point: T,
  selectedIdx: number | null,
): { waypoints: T[]; selectedIdx: number } {
  const at = (selectedIdx != null && selectedIdx >= 0 && selectedIdx < waypoints.length - 1)
    ? selectedIdx + 1
    : waypoints.length
  const next = [...waypoints.slice(0, at), point, ...waypoints.slice(at)]
  return { waypoints: next, selectedIdx: at }
}
