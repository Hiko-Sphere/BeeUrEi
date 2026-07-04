import type { HelpRequest } from './api'

/// 求助队列的"新到"挑选（纯逻辑，可单测）：与上次已提示集合比对，返回本轮**新出现**的求助 +
/// 下一轮的已提示集合（=当前队列全部 id：已离队的自动被剪掉，集合有界；同 id 离队后再回来会再次提示——
/// 它确实又在等人了）。志愿者感知层用：待命中出现新求助要出声，否则盲人在队列里干等而志愿者毫无察觉。
export function pickNewHelpRequests(requests: HelpRequest[], alerted: ReadonlySet<string>): { fresh: HelpRequest[]; nextAlerted: Set<string> } {
  const fresh = requests.filter((r) => !alerted.has(r.callId))
  return { fresh, nextAlerted: new Set(requests.map((r) => r.callId)) }
}

/// 求助到达提示音：两声中频短鸣（660Hz）——与紧急告警的三声高频（880Hz）刻意区分：求助要引起注意，
/// 但不该像紧急事件那样惊人。浏览器自动播放策略下需先有用户手势——待命志愿者已交互过；失败静默（toast 视觉兜底）。
export function playHelpChime(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const t0 = ctx.currentTime
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 660
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.22)
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + i * 0.22 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.18)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + i * 0.22)
      osc.stop(t0 + i * 0.22 + 0.2)
    }
    window.setTimeout(() => { void ctx.close().catch(() => {}) }, 900) // 播完释放音频句柄
  } catch { /* 自动播放被拒/无音频设备：toast 视觉兜底 */ }
}
