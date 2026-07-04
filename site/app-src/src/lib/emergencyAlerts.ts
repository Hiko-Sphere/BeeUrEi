import type { NotificationInfo } from './api'

/// 紧急告警的实时挑选（纯逻辑，可单测）：从通知列表里取出应当**立即弹出模态**的告警。
///
/// 背景：摔倒/车祸/手动 SOS 告警此前在网页端只是角标 +1——正盯着聊天页的协助者完全不会注意到。
/// 告警链路（在线优先→位置兜底→诚实标注）的最后一米是"到达即被看见"：未读紧急告警须弹模态+提示音。
///
/// 规则：kind 含 emergency 且**不是回执(emergency_ack)** 且未读且未被本次会话内"稍后"过 → 按时间倒序。
/// - 以**服务端 readAt** 为真相：点"知道了"标已读后永不再弹（跨设备一致）；
/// - "稍后"只记在内存（sessionDismissed）：本会话不再骚扰，但刷新后仍会弹——告警未确认前不该被永久静默。
/// - **排除 emergency_ack**："X 已看到你的求助"是给发起人的反馈，绝不能当成新告警弹响铃大模态
///   （否则 web 端既发过告警又收到回执的用户会被自己联系人的"知道了"误弹一次紧急模态）。
export function pickUnreadEmergencies(list: NotificationInfo[], sessionDismissed: ReadonlySet<string>): NotificationInfo[] {
  return list
    .filter((n) => n.kind.includes('emergency') && n.kind !== 'emergency_ack' && !n.readAt && !sessionDismissed.has(n.id))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/// 提示音（三声短促蜂鸣）：紧急告警到达时把听觉注意力拉回来。浏览器自动播放策略下 AudioContext
/// 需用户先有过手势——协助者通常已交互过；失败静默忽略（模态仍在，视觉兜底）。
export function playEmergencyChime(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const t0 = ctx.currentTime
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.25)
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + i * 0.25 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.25 + 0.2)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + i * 0.25)
      osc.stop(t0 + i * 0.25 + 0.22)
    }
    // 播完关闭上下文，释放音频硬件句柄。
    window.setTimeout(() => { void ctx.close().catch(() => {}) }, 1200)
  } catch { /* 自动播放被拒/无音频设备：视觉模态兜底 */ }
}
