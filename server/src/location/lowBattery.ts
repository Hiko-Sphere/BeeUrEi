/// 共享位置期间"手机快没电"预警家人的判定（纯逻辑，可单测）。
///
/// 盲人独自出行时手机=导航+SOS+求助的唯一工具，没电即失联且失去自救手段。对标 Life360/Find My 的
/// "X 的手机电量低"提醒：当正在共享位置者的电量跌破阈值，主动通知**本就能看其位置的**已接受亲友，
/// 让家人在其失联前主动联系。只在**跌破那一刻**提醒一次（每次耗电周期一次），不每帧轰炸。
///
/// **滞回**（warnAt < clearAt）防在阈值附近抖动反复提醒：一旦已提醒，须电量回升到 clearAt（充上电/缓过来）
/// 才复位；复位后再次跌破才会再提醒。缺电量读数（undefined）不改变状态（不猜）。
export interface LowBatteryDecision {
  warn: boolean      // 本次是否应发预警（false→true 跌破那一刻）
  warned: boolean    // 更新后的"已提醒"状态（写回会话态）
}

export function decideLowBatteryWarn(
  prevWarned: boolean, battery: number | undefined, warnAtPct: number, clearAtPct: number,
): LowBatteryDecision {
  // 无电量读数：状态不变（有些客户端不报电量，绝不因缺读数误报或误复位）。
  if (battery == null || !Number.isFinite(battery)) return { warn: false, warned: prevWarned }
  if (!prevWarned) {
    // 未提醒过：跌到 warnAt 及以下 → 提醒一次并置位。
    if (battery <= warnAtPct) return { warn: true, warned: true }
    return { warn: false, warned: false }
  }
  // 已提醒过：回升到 clearAt 及以上 → 复位（下次再跌破可再提醒）；否则保持已提醒、不重复。
  if (battery >= clearAtPct) return { warn: false, warned: false }
  return { warn: false, warned: true }
}
