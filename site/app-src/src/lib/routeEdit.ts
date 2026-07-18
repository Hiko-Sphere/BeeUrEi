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

/// 把第 i 个航点**原地移动**到新坐标（地图上拖动标记微调位置）：保留 note 等附加字段。
/// 越界索引或非有限坐标 → 原样返回（不动，与全库"坏输入不动作"一贯原则；Leaflet 正常不会给非有限，防御为主）。
export function moveWaypointTo<T extends LatLng>(waypoints: readonly T[], i: number, lat: number, lng: number): T[] {
  if (i < 0 || i >= waypoints.length || !Number.isFinite(lat) || !Number.isFinite(lng)) return [...waypoints]
  const next = [...waypoints]
  next[i] = { ...next[i], lat, lng }
  return next
}

/// 删除第 i 个航点，并**正确调整选中索引**（此前 Routes.tsx 内联 `filter` + 一律 `setSelectedIdx(null)`：删
/// 任意点都清空当前选中，中段编辑时很烦——删掉误加的点后想接着在原选中点后补点，选中却没了、只能重选）。
/// 返回新序列与调整后的选中索引：
/// - 无选中，或删的正是选中点 → null；
/// - 选中点在被删点**之后**（selectedIdx > i）→ 索引 −1（它整体前移一格，仍指向同一个航点）；
/// - 选中点在被删点**之前**（selectedIdx < i）→ 索引不变。
/// 越界 i → 原样返回、选中不变（坏输入不动作，同 moveWaypointTo）。保留 note 等附加字段。
export function deleteWaypoint<T extends LatLng>(
  waypoints: readonly T[],
  i: number,
  selectedIdx: number | null,
): { waypoints: T[]; selectedIdx: number | null } {
  if (i < 0 || i >= waypoints.length) return { waypoints: [...waypoints], selectedIdx }
  const next = waypoints.filter((_, j) => j !== i)
  let sel: number | null
  if (selectedIdx == null || selectedIdx === i) sel = null
  else if (selectedIdx > i) sel = selectedIdx - 1
  else sel = selectedIdx
  return { waypoints: next, selectedIdx: sel }
}
