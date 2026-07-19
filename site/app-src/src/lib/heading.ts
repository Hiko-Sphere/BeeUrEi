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

/// 上报共享位置前的「行进方向」可信过滤（与 iOS 核心 CourseFilter 同原则：**valid ≠ trustworthy for direction**）。
/// web Geolocation 无 courseAccuracy 字段，改用 `coords.speed` 门控：低速/静止时 heading 是噪声——规范上 speed=0
/// 时 heading 应为 NaN，但浏览器实现不一、低速非零仍乱指；八方位每档 45°、大误差会整档报错，误导监护家人判断
/// 盲人是否朝约定地点走。返回归一到 [0,360) 的可信航向，否则 null（不上报＝对端省略"移动方向"，好过报错方向）。
/// speed 单位 m/s；阈值 0.5 m/s（约 1.8 km/h，慢走下限）——从宽保留稳定行走、仅剔近静止噪声。
/// speed 缺失（浏览器不报）→ 退化为仅按 heading 有效判定（不误伤、不改旧行为，与 iOS CourseFilter 的 nil 精度退化同）。
export const MIN_HEADING_SPEED_MPS = 0.5
export function trustworthyHeading(
  heading: number | null | undefined,
  speed: number | null | undefined,
  minSpeedMps = MIN_HEADING_SPEED_MPS,
): number | null {
  if (heading == null || !Number.isFinite(heading)) return null
  // speed 可用且低于阈值＝近静止噪声 → 剔除；speed 缺失/非有限 → 不门控（退化为旧行为，不误伤无速度来源）。
  if (speed != null && Number.isFinite(speed) && speed < minSpeedMps) return null
  return (((heading % 360) + 360) % 360)
}

/// 共享位置的「行进方向」短语：协助者据此判断对方是否正朝约定地点移动（Find My/Google 式方向指示，但用**文字**、
/// 兼顾读屏与看不清地图箭头者）。heading 源自浏览器 Geolocation.course——仅移动时有效，静止/不可用为 NaN/null → 返回 null（不展示）。
export function headingPhrase(deg: number | null | undefined, lang: 'zh' | 'en'): string | null {
  const dir = cardinal(deg, lang)
  if (dir == null) return null
  return lang === 'zh' ? `正朝${dir}方向移动` : `moving ${dir}`
}
