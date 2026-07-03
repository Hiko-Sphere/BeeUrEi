/// 紧急告警位置的诚实标注（纯逻辑，可单测）。
///
/// 服务端在告警缺实时定位时会兜底附「最后已知共享位置」，并在通知 data 里标
/// `locSource: 'lastKnown'` + `locAgeSec`（定位距告警发出时的秒数）。协助端渲染位置链接时
/// **必须区分**：把 15 分钟前的最后已知位置当实时位置展示，会让协助者赶去错误地点。
///
/// 定位时刻用**绝对时间**（= 告警时刻 − ageSec），而非"N 分钟前"相对措辞——通知可能在数小时后
/// 才被看到，"5 分钟前"会随阅读时刻漂移成谎言；绝对时刻永远为真。
export interface EmergencyLocInfo {
  /// 是否为「最后已知」兜底位置（非告警时刻的实时定位）。
  stale: boolean
  /// 定位时刻(ms)；仅 stale 且 ageSec 可解析时给出，供渲染"最后已知位置 · HH:MM"。
  fixAt: number | null
}

export function emergencyLocInfo(data: Record<string, string | undefined> | undefined, createdAt: number): EmergencyLocInfo {
  if (!data || data.locSource !== 'lastKnown') return { stale: false, fixAt: null }
  const age = Number(data.locAgeSec)
  // ageSec 缺失/坏值：仍如实标"最后已知"（stale 本身不依赖时效解析），只是不给定位时刻。
  return { stale: true, fixAt: Number.isFinite(age) && age >= 0 ? createdAt - age * 1000 : null }
}
