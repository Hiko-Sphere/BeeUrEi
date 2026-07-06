/// 方位角（度，0=正北，顺时针）→ 八方位名（双语），与 iOS 核心 CompassRose 同口径：同名称、同 +22.5° 扇区中心
/// （每 45° 扇区以正方位为中心，如 [337.5,22.5)→正北）。非有限（NaN/∞）或缺省 → null（绝不 `Int(非有限)` 崩、不瞎报方向）。
export function cardinal(deg: number | null | undefined, lang: 'zh' | 'en'): string | null {
  if (deg == null || !Number.isFinite(deg)) return null
  const names = lang === 'zh'
    ? ['正北', '东北', '正东', '东南', '正南', '西南', '正西', '西北']
    : ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
  const normalized = (((deg % 360) + 360 + 22.5) % 360)
  const idx = Math.min(Math.floor(normalized / 45), 7) // 归一后必 <8；min 兜底浮点边界
  return names[idx]
}

/// 共享位置的「行进方向」短语：协助者据此判断对方是否正朝约定地点移动（Find My/Google 式方向指示，但用**文字**、
/// 兼顾读屏与看不清地图箭头者）。heading 源自浏览器 Geolocation.course——仅移动时有效，静止/不可用为 NaN/null → 返回 null（不展示）。
export function headingPhrase(deg: number | null | undefined, lang: 'zh' | 'en'): string | null {
  const dir = cardinal(deg, lang)
  if (dir == null) return null
  return lang === 'zh' ? `正朝${dir}方向移动` : `moving ${dir}`
}
