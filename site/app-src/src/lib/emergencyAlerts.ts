import type { NotificationInfo } from './api'

/// 紧急告警的实时挑选（纯逻辑，可单测）：从通知列表里取出应当**立即弹出模态**的告警。
///
/// 背景：摔倒/车祸/手动 SOS 告警此前在网页端只是角标 +1——正盯着聊天页的协助者完全不会注意到。
/// 告警链路（在线优先→位置兜底→诚实标注）的最后一米是"到达即被看见"：未读紧急告警须弹模态+提示音。
///
/// 规则：kind **恰为** `emergency_alert`（真告警）且未读且未被本次会话内"稍后"过 → 时间倒序。
/// - 以**服务端 readAt** 为真相：点"知道了"标已读后永不再弹（跨设备一致）；
/// - "稍后"只记在内存（sessionDismissed）：本会话不再骚扰，但刷新后仍会弹——告警未确认前不该被永久静默。
/// - **白名单**（恰等 emergency_alert）而非黑名单（含 emergency 减去 ack/clear）：所有真告警（SOS/摔倒/未报到/
///   升级重呼）服务端一律用 `emergency_alert`；一切反馈/协调类（ack 回执 / clear 报平安 / responding 有人响应）
///   都不是这个 kind，天然不弹响铃大模态。白名单杜绝"新增一个 emergency_* 反馈 kind 忘了加进黑名单就误弹告警"。
export function pickUnreadEmergencies(list: NotificationInfo[], sessionDismissed: ReadonlySet<string>): NotificationInfo[] {
  const filtered = list
    .filter((n) => n.kind === 'emergency_alert' && !n.readAt && !sessionDismissed.has(n.id))
    .sort((a, b) => b.createdAt - a.createdAt) // 时间倒序：最新（升级重呼版）在前
  // 同一次告警事件的多条通知（首呼 + 升级重呼，共用同一 eventId）合并为一条——取**最新**那条（升级版措辞更急、
  // 是当前状态）。否则漏看首呼、开 App 时才拾取的协助者会看到同一次求助弹两遍。无 eventId 的老通知不合并。
  const seenEvent = new Set<string>()
  return filtered.filter((n) => {
    const ev = n.data?.eventId
    if (!ev) return true
    if (seenEvent.has(ev)) return false
    seenEvent.add(ev)
    return true
  })
}

/// "知道了"时应一并标已读 + 会话静默的**同一告警事件**全部通知 id。
///
/// 背景：R48 升级重呼会为同一次事件（同 eventId）再建一条通知，pickUnreadEmergencies 已把"首呼 + 升级重呼"
/// 折叠成一条展示。但若"知道了"只标被展示那一条（升级版）已读，另一条（首呼）仍未读——下一轮轮询又被拾起、
/// 重新弹模态 + 响铃：协助者明明已确认，同一次求助却在几秒后诡异地又冒出来。故按 eventId 收敛：确认时把该事件
/// 的**全部**告警通知一起标读 + 静默。无 eventId 的老通知只收敛自身（向后兼容）。top 自身始终包含（防御：即便
/// 它不在传入列表里）。
export function ackEventNotifIds(list: NotificationInfo[], top: NotificationInfo): string[] {
  const ev = top.data?.eventId
  if (!ev) return [top.id]
  const ids = list
    .filter((n) => n.data?.eventId === ev && n.kind === 'emergency_alert') // 白名单同 pickUnreadEmergencies：只收敛真告警通知
    .map((n) => n.id)
  return ids.includes(top.id) ? ids : [top.id, ...ids]
}

/// 已被发起人"报平安(emergency_clear)"解除的告警发起人 id 集合：其名下所有告警应就地消掉（对方已没事，
/// 让担心的亲友立刻安心）。按 **fromId** 关联而非精确 id——告警通知带 eventId、报平安带 alertId（两套 id
/// 空间不同），且"X 报平安"本就意味 X 的所有未决告警都可解除，按发起人聚合正是想要的语义。
export function clearedSenderIds(list: NotificationInfo[]): Set<string> {
  const s = new Set<string>()
  for (const n of list) if (n.kind === 'emergency_clear' && n.data?.fromId) s.add(n.data.fromId)
  return s
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
