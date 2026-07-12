/// 距离单位（公制 米/公里 · 英制 英尺/英里），与 iOS 核心 DistanceUnit 同口径——协助端家人遍布全球，
/// 英语区惯用英尺/英里，每次看到"1.2 公里"都要心算换算。默认公制（不打扰现有用户），可在账户设置切换。
/// 纯客户端显示偏好（不影响服务端通知/围栏），持久化 localStorage，无需上送服务端。
export type DistanceUnit = 'metric' | 'imperial'

const LS_UNIT = 'beeurei.web.distanceUnit'
const M_PER_FT = 0.3048
const M_PER_MI = 1609.344

export function getUnit(): DistanceUnit {
  try {
    return localStorage.getItem(LS_UNIT) === 'imperial' ? 'imperial' : 'metric'
  } catch {
    return 'metric' // localStorage 不可用（隐私模式等）→ 公制兜底
  }
}
export function setUnit(u: DistanceUnit): void {
  try { localStorage.setItem(LS_UNIT, u) } catch { /* 存不了就本次会话内用，不报错 */ }
}

/// 位置尺度距离的**数值+单位**串（不含"约/精确到"前缀，调用方按语境加）。与 iOS DistanceUnit.farDistance 同口径：
/// 公制 ≥1km 用公里(0.1 精度、去尾零)否则整米；英制 ≥1000ft 用英里(同)否则整英尺。溢出/非有限安全（夹 [0,1e6]，
/// 非有限/≤0 归 0）。用**完整/惯用**单位词，读屏清晰。
export function farDistance(meters: number, unit: DistanceUnit, t: (zh: string, en: string) => string): string {
  const m = Number.isFinite(meters) && meters > 0 ? Math.min(meters, 1_000_000) : 0
  if (unit === 'imperial') {
    const feet = m / M_PER_FT
    if (feet >= 1000) {
      const mi = (Math.round((m / M_PER_MI) * 10) / 10).toString() // 0.1 英里、去尾零
      return t(`${mi} 英里`, `${mi} mi`)
    }
    return t(`${Math.round(feet)} 英尺`, `${Math.round(feet)} ft`)
  }
  if (m >= 1000) {
    const km = (Math.round(m / 100) / 10).toString() // 0.1 公里、去尾零（与既有 accuracyText/routeDistanceText 同）
    return t(`${km} 公里`, `${km} km`)
  }
  return t(`${Math.round(m)} 米`, `${Math.round(m)} m`)
}
