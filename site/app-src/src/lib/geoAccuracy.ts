import { farDistance, type DistanceUnit } from './distanceUnit'

/// 共享位置的 GPS 精度显示（Find My/Google Maps 式精度圈的纯逻辑，可单测）。
/// 只在精度**有限且为正**时展示——NaN/Infinity/0/负值都视为"无精度信息"，不画误导性的圈、不报假数字。

/// 校验并返回可用于圈半径（米）的精度；无效返回 null。
export function validAccuracyMeters(accuracy: number | null | undefined): number | null {
  return typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null
}

/// 精度文字（读屏/看不清圈时也知道有多准）："精确到约 20 米"/"~66 ft accuracy"；无效精度返回 null（调用方省略）。
/// 数值+单位走 DistanceUnit.farDistance 同一换算源：公制 ≥1km 用公里(粗定位「约 1.5 公里」远胜「1500 米」)、英制→英尺/英里
/// （英语区家人惯用）。unit 默认公制＝现有行为**逐字不变**（既有测试守卫）。
export function accuracyText(
  accuracy: number | null | undefined,
  t: (zh: string, en: string) => string,
  unit: DistanceUnit = 'metric',
): string | null {
  const a = validAccuracyMeters(accuracy)
  if (a == null) return null
  const far = farDistance(a, unit, t)
  return t(`精确到约 ${far}`, `~${far} accuracy`)
}

/// 粗定位阈值（米）：≥ 此值视为"大致区域"而非街道级定位。GPS 5–50m、WiFi 20–150m、蜂窝 150–1000m、
/// IP 定位 1km–数十 km——500m 干净地把"街道级可寻"与"只看得到大致区域"分开，避免对手机常见的几十米定位过度告警。
export const COARSE_ACCURACY_M = 500

/// 共享者**自视**的精度提示（纯逻辑，可单测）：分享方看到自己这次定位有多准。桌面浏览器常按 IP/WiFi 定位到
/// 公里级——分享者却以为"家人能看到我精确位置"。粗定位时明确告知"联系人只看到大致区域"，与本 App 一贯的诚实
/// 位置标注（emergencyLocInfo / "未能定位"）同旨。无有效精度返回 null（不显示，不报假数字）。
export function shareAccuracyNote(
  accuracy: number | null | undefined,
  t: (zh: string, en: string) => string,
  unit: DistanceUnit = 'metric',
): { text: string; coarse: boolean } | null {
  const a = validAccuracyMeters(accuracy)
  if (a == null) return null
  const label = accuracyText(accuracy, t, unit)! // a 有效 → 必非 null
  const coarse = a >= COARSE_ACCURACY_M
  const text = coarse ? t(`${label}·较粗略，联系人只看到大致区域`, `${label} · coarse — contacts see only an approximate area`) : label
  return { text, coarse }
}
