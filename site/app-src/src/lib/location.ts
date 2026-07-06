// 解析位置消息文本：两种形态都认——
//  ① JSON {lat,lng,name?}（App/web 主动发的位置）
//  ② 内嵌 https://maps.apple.com/?ll=lat,lng&q=name 文本链接（iOS 兼容未升级服务端时发的形态）
// 均做经纬度范围与有限性校验；任何畸形/越界/非位置输入返回 null（绝不抛错——文本来自用户可控消息）。
/// 构造 Apple Maps 链接（项目约定：地图链接一律 Apple Maps——境内可打开且自动 WGS-84→GCJ 纠偏，OSM 境内常不可达）。
/// 坐标为 WGS-84（全栈约定）。有 label 则编码作查询名（如联系人名）；无 label 用"经,纬"当查询名。
export function appleMapsUrl(lat: number | string, lng: number | string, label?: string): string {
  const q = label && String(label).trim() ? encodeURIComponent(label) : `${lat},${lng}`
  return `https://maps.apple.com/?ll=${lat},${lng}&q=${q}`
}

/// 聊天"发送我的位置"的消息正文（与 iOS LocationPayload.asText() 无名形式同口径：📍\n + Apple 地图链接）。
/// kind 用 'text'（内嵌链接），故 web/iOS 两端 parseLocation 都能把它还原成同一个位置气泡。
/// 坐标 6 位小数（≈0.1m，与 iOS %.6f 对齐）；WGS-84（浏览器定位原系，勿转）。非有限/越界坐标 → null（不发假位置）。
export function locationMessageText(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return `📍\nhttps://maps.apple.com/?ll=${lat.toFixed(6)},${lng.toFixed(6)}`
}

/// 两点间大圆（haversine）距离（米，WGS-84，与服务端 geofence 同算法）。任一坐标非有限→0（绝不抛/NaN 污染）。
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  if (![aLat, aLng, bLat, bLng].every((n) => Number.isFinite(n))) return 0
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/// 路线总步行距离（米）：相邻航点大圆距离之和。<2 点或坏点段计 0（haversineMeters 已守卫非有限）。
export function routeDistanceMeters(waypoints: { lat: number; lng: number }[]): number {
  let total = 0
  for (let i = 1; i < waypoints.length; i++) {
    total += haversineMeters(waypoints[i - 1].lat, waypoints[i - 1].lng, waypoints[i].lat, waypoints[i].lng)
  }
  return total
}

/// 路线距离可读文本：≥1km 用公里(0.1 精度去尾零)，否则整米——"约 1.2 公里"胜过"约 1200 米"（同 accuracyText 口径）。
export function routeDistanceText(meters: number, t: (zh: string, en: string) => string): string {
  const m = Number.isFinite(meters) && meters > 0 ? meters : 0
  if (m >= 1000) {
    const km = (Math.round(m / 100) / 10).toString() // 四舍五入到 0.1km、toString 去尾零（2.0→2）
    return t(`约 ${km} 公里`, `~${km} km`)
  }
  return t(`约 ${Math.round(m)} 米`, `~${Math.round(m)} m`)
}

export function parseLocation(text: string): { lat: number; lng: number; name?: string } | null {
  // 防御：text 类型虽为 string，但消息字段可能因后端数据异常为 null/undefined——
  // 下方 text.indexOf 在 try/catch 之外，无此守卫会抛 TypeError、连累整条聊天列表/会话渲染崩。
  if (typeof text !== 'string' || text === '') return null
  try {
    const j = JSON.parse(text) as { lat?: unknown; lng?: unknown; name?: unknown }
    if (typeof j.lat === 'number' && typeof j.lng === 'number'
        && j.lat >= -90 && j.lat <= 90 && j.lng >= -180 && j.lng <= 180) {
      return { lat: j.lat, lng: j.lng, name: typeof j.name === 'string' ? j.name : undefined }
    }
  } catch { /* 非 JSON：尝试文本链接形式 */ }
  const i = text.indexOf('https://maps.apple.com/?ll=')
  if (i < 0) return null
  try {
    const u = new URL(text.slice(i).split(/\s/)[0]) // 取到首个空白为止
    const parts = (u.searchParams.get('ll') ?? '').split(',')
    if (parts.length !== 2) return null
    const lat = Number(parts[0]), lng = Number(parts[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
    return { lat, lng, name: u.searchParams.get('q') || undefined }
  } catch { return null }
}
