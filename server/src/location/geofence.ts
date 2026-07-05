import { type SavedPlace } from '../db/store'

/// 到达/离开围栏判定（Life360/Find My "已到家"/"离开家"式）——盲人到达或离开"家/公司"时提醒正在看其共享位置的家人。
/// 纯逻辑、可单测。**滞回**避免 GPS 在边界抖动反复触发：之前判"在外"须进入 enterRadius(默认150m) 才算入；
/// 之前判"在内"须离到 exitRadius(默认200m) 外才算出。只对**有坐标**的地点判定（无坐标=geocode 失败/境外，跳过）。
/// 只在"外→内"转换算"新到达"、"内→外"转换算"离开"（去重：停留/在外期间不重复提醒）。坐标均 WGS-84（与客户端上报同系）。

export interface GeofenceResult {
  arrived: SavedPlace[]     // 本次从"外"进"内"的地点（触发到达通知）
  departed: SavedPlace[]    // 本次从"内"出"外"的地点（触发离开通知，与到达对等、同一滞回门槛）
  insideLabels: string[]    // 更新后仍在内的 label（调用方存回，作下次 prevInside）
}

const EARTH_R = 6371000 // 米
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function evaluateGeofences(
  current: { lat: number; lon: number },
  places: SavedPlace[],
  prevInside: Set<string>,
  enterRadius = 150,
  exitRadius = 200,
): GeofenceResult {
  // 坏定位：绝不误判"到达/离开"，保持原状。
  if (!Number.isFinite(current.lat) || !Number.isFinite(current.lon)) {
    return { arrived: [], departed: [], insideLabels: [...prevInside] }
  }
  const arrived: SavedPlace[] = []
  const departed: SavedPlace[] = []
  const insideLabels: string[] = []
  for (const p of places) {
    if (p.lat == null || p.lng == null || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue // 无坐标跳过
    const d = haversineMeters(current.lat, current.lon, p.lat, p.lng)
    const wasInside = prevInside.has(p.label)
    const nowInside = wasInside ? d <= exitRadius : d <= enterRadius // 滞回
    if (nowInside) {
      insideLabels.push(p.label)
      if (!wasInside) arrived.push(p) // 外→内：新到达
    } else if (wasInside) {
      departed.push(p) // 内→外：离开（越出 exitRadius 才判定，与到达同一滞回门槛）
    }
  }
  return { arrived, departed, insideLabels }
}
