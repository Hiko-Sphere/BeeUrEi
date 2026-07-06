/// 安全报到（dead-man's switch）剩余时间/时长格式化（纯逻辑，可单测）。与 iOS SafetyTimerFormat 同口径，跨端一致。
export function remainingText(sec: number, lang: 'zh' | 'en'): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (lang === 'zh') return h > 0 ? `还有约 ${h} 小时 ${m} 分钟` : `还有约 ${m} 分钟`
  return h > 0 ? `About ${h}h ${m}m left` : `About ${m} min left`
}

/// 时长选项显示名（30 分钟 / 2 小时…）。
export function durationName(min: number, lang: 'zh' | 'en'): string {
  if (min >= 60 && min % 60 === 0) {
    const h = min / 60
    return lang === 'zh' ? `${h} 小时` : `${h}h`
  }
  return lang === 'zh' ? `${min} 分钟` : `${min} min`
}
