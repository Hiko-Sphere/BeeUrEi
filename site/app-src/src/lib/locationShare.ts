/// 定时位置共享（Google Maps / Life360 式"共享 N 时间后自动停止"）纯逻辑，可单测。
/// 到点自动停止，用户不必记得手动关——独自出行的盲人尤其受益（设 1 小时到家自动停，不会忘关而长期暴露）。

export interface ShareDurationOption { sec: number; zh: string; en: string }

/// 可选共享时长（0 = 直到我手动停止，与旧行为一致）。
export const SHARE_DURATIONS: readonly ShareDurationOption[] = [
  { sec: 900, zh: '15 分钟', en: '15 min' },
  { sec: 3600, zh: '1 小时', en: '1 hour' },
  { sec: 28800, zh: '8 小时', en: '8 hours' },
  { sec: 0, zh: '直到我停止', en: 'Until I stop' },
]

/// 据本次共享截止时刻算上报 ttlSec（服务端约束 [60,3600]）。deadlineMs<=0（无截止）→ undefined（用服务端默认、不自动停）。
/// 让服务端 sharingUntil 贴近真实剩余：客户端崩溃/关页后共享很快过期（配合 90s 可见性新鲜度门，联系人尽早看不到）。
/// 剩余 > 1 小时时封顶 3600（服务端上限）——客户端仍靠本地定时器在真实截止时刻停止，ttl 只是"客户端消失"的兜底。
export function shareTtlSec(deadlineMs: number, nowMs: number): number | undefined {
  if (deadlineMs <= 0) return undefined
  const remainingSec = Math.ceil((deadlineMs - nowMs) / 1000)
  return Math.max(60, Math.min(3600, remainingSec))
}
