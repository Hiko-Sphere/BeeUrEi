/// 安全报到（dead-man's switch）剩余时间/时长格式化（纯逻辑，可单测）。与 iOS SafetyTimerFormat 同口径，跨端一致。
export function remainingText(sec: number, lang: 'zh' | 'en'): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  // 整点小时不拖"0 分钟"（"2 小时"而非"2 小时 0 分钟"——与 durationName / iOS hoursMinutesPhrase 同口径；
  // 报到窗口最长 24h，倒计时每小时会经过一次整点分钟，"X 小时 0 分钟"读屏冗余）。
  if (lang === 'zh') {
    if (h > 0) return m > 0 ? `还有约 ${h} 小时 ${m} 分钟` : `还有约 ${h} 小时`
    return `还有约 ${m} 分钟`
  }
  if (h > 0) return m > 0 ? `About ${h}h ${m}m left` : `About ${h}h left`
  return `About ${m} min left`
}

/// 安全报到实时剩余秒数：从绝对到期时刻 dueAt 减当前时刻，取整、floored 到 0。用于倒计时**每秒递减显示**——
/// 服务端 remainingSec 只是取时快照，卡片开着不会动，半小时后仍显"还有约 60 分钟"是 dead-man's switch 的危险误导。
/// 用绝对 dueAt（服务端时钟）比对本机 now：本机时钟通常 NTP 同步、偏差 <1s，对分钟粒度可忽略；坏输入(非有限)→0，绝不显 NaN/负。
export function liveRemainingSecFromDue(dueAtMs: number, nowMs: number): number {
  if (!Number.isFinite(dueAtMs) || !Number.isFinite(nowMs)) return 0
  return Math.max(0, Math.round((dueAtMs - nowMs) / 1000))
}

/// 每日报到"下次开始"的本地化短标签（"今天 09:00" / "明天 09:00"）：给启用中的每日报到一个持久确认——
/// 用户一眼看到安全网**已生效且下次何时触发**（比 toast 一闪更安心）。用本机当前时钟判今天/明天（配置时区
/// 即本机时区、二者一致；跨时区旅行的偏差属暂停/旅行场景，本标签只做常态确认）。now 注入便于单测。
export function nextCheckinLabel(startMinute: number, now: Date, t: (zh: string, en: string) => string): string {
  const h = Math.floor(startMinute / 60), m = startMinute % 60
  const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  const nowMin = now.getHours() * 60 + now.getMinutes()
  return nowMin < startMinute ? t(`今天 ${hhmm}`, `today at ${hhmm}`) : t(`明天 ${hhmm}`, `tomorrow at ${hhmm}`)
}

/// 时长选项显示名（30 分钟 / 2 小时…）。
export function durationName(min: number, lang: 'zh' | 'en'): string {
  if (min >= 60 && min % 60 === 0) {
    const h = min / 60
    return lang === 'zh' ? `${h} 小时` : `${h}h`
  }
  return lang === 'zh' ? `${min} 分钟` : `${min} min`
}
