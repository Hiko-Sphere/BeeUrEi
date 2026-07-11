/// 当前是否处于勿扰时段（纯逻辑，可单测）：给"当前勿扰中"持久指示用——用户设了勿扰却不知此刻是否生效、
/// 为何收不到推送横幅时，一眼确认"正在勿扰"。用本机当前时钟判（配置时区即本机时区，二者一致；跨时区旅行
/// 的偏差属边缘场景）。start===end 视为无窗口（UI 也禁止二者相同）。跨午夜窗口（如 22:00–07:00，start>end）
/// = [start,24h) ∪ [0,end)；同日窗口（start<end）= [start,end)。与服务端 quietHours 抑制判定同口径。
export function inQuietHoursNow(startMinute: number, endMinute: number, now: Date): boolean {
  const cur = now.getHours() * 60 + now.getMinutes()
  if (startMinute === endMinute) return false // 相同=无有效窗口
  return startMinute < endMinute
    ? cur >= startMinute && cur < endMinute   // 同日窗口 [start, end)
    : cur >= startMinute || cur < endMinute    // 跨午夜窗口 [start, 24h) ∪ [0, end)
}
