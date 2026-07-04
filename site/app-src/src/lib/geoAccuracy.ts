/// 共享位置的 GPS 精度显示（Find My/Google Maps 式精度圈的纯逻辑，可单测）。
/// 只在精度**有限且为正**时展示——NaN/Infinity/0/负值都视为"无精度信息"，不画误导性的圈、不报假数字。

/// 校验并返回可用于圈半径（米）的精度；无效返回 null。
export function validAccuracyMeters(accuracy: number | null | undefined): number | null {
  return typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null
}

/// 精度文字（读屏/看不清圈时也知道有多准）："精确到约 20 米"；无效精度返回 null（调用方省略）。
export function accuracyText(
  accuracy: number | null | undefined,
  t: (zh: string, en: string) => string,
): string | null {
  const a = validAccuracyMeters(accuracy)
  if (a == null) return null
  const m = Math.round(a)
  return t(`精确到约 ${m} 米`, `~${m} m accuracy`)
}
