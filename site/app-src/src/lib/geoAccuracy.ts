/// 共享位置的 GPS 精度显示（Find My/Google Maps 式精度圈的纯逻辑，可单测）。
/// 只在精度**有限且为正**时展示——NaN/Infinity/0/负值都视为"无精度信息"，不画误导性的圈、不报假数字。

/// 校验并返回可用于圈半径（米）的精度；无效返回 null。
export function validAccuracyMeters(accuracy: number | null | undefined): number | null {
  return typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy > 0 ? accuracy : null
}

/// 精度文字（读屏/看不清圈时也知道有多准）："精确到约 20 米"；无效精度返回 null（调用方省略）。
/// 大范围（≥1km，粗定位/室内网络定位，服务端精度上限 100km）改用**公里**——读屏念「约 1.5 公里 / ~100 km」
/// 远胜「约 1500 米 / ~100000 m」，后者对听者几乎无法快速换算量级。保留 1 位小数并去尾零（2.0→2）。
export function accuracyText(
  accuracy: number | null | undefined,
  t: (zh: string, en: string) => string,
): string | null {
  const a = validAccuracyMeters(accuracy)
  if (a == null) return null
  if (a >= 1000) {
    const km = (Math.round(a / 100) / 10).toString() // 四舍五入到 0.1km、toString 去尾零
    return t(`精确到约 ${km} 公里`, `~${km} km accuracy`)
  }
  const m = Math.round(a)
  return t(`精确到约 ${m} 米`, `~${m} m accuracy`)
}
