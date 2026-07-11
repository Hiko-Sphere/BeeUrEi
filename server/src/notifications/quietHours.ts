import type { QuietHours } from '../db/store'

/// 勿扰时段判定（纯逻辑，可单测）。**安全原则：一切坏/缺配置一律 fail-open（返回 false=不勿扰）**——
/// 绝不因配置错误静默吞掉本该送达的通知（漏推比多推更糟）。紧急告警/来电/SOS 不经此（走独立扇出）。

/// 给定 IANA 时区在某 UTC 毫秒时刻的"本地分钟-of-day" [0,1439]；非法时区/异常 → null。
/// 用 Intl（Node 内置 tz 数据库，正确处理 DST），不手算偏移。
export function localMinuteOfDay(nowMs: number, tz: string): number | null {
  // 缺失/空 tz 必须 fail-open：Intl 对 timeZone:undefined **不抛错**、而是回退到**服务器本地时区**，
  // 会用服务器时间误判勿扰、在错误时段吞掉盲人的通知（QuietHours 来自未校验的 JSON 反序列化，
  // 陈旧/损坏行可能 enabled 却无 tz）。空字符串走 Intl 会抛 → 已被 catch，但 undefined/非串须在此显式挡。
  if (typeof tz !== 'string' || tz.trim() === '') return null
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(nowMs))
    const h = Number(parts.find((p) => p.type === 'hour')?.value)
    const m = Number(parts.find((p) => p.type === 'minute')?.value)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null
    return (h % 24) * 60 + m // hour12:false 在部分实现午夜返回 "24"，取模归一到 [0,1439]
  } catch {
    return null // 非法 tz 字符串 → Intl 抛 RangeError → 视作无勿扰
  }
}

/// 某时刻在指定时区的本地日期（YYYY-MM-DD）。坏/缺 tz → null（与 localMinuteOfDay 同 fail-open 口径）。
/// 用于"每日一次"类幂等标记（每日定时安全报到）：跨午夜/DST 由 Intl 正确处理，绝不手算偏移。
export function localDayIn(nowMs: number, tz: string): string | null {
  if (typeof tz !== 'string' || tz.trim() === '') return null
  try {
    // en-CA 的日期格式恰为 YYYY-MM-DD（稳定、可比较、可存储）。
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs))
  } catch {
    return null
  }
}

/// 现在是否处于该用户的勿扰时段。未启用/配置非法/时区非法一律返回 false（fail-open）。
export function isQuietedNow(q: QuietHours | undefined, nowMs: number): boolean {
  if (!q || !q.enabled) return false
  const { startMinute: s, endMinute: e } = q
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || s > 1439 || e < 0 || e > 1439) return false
  if (s === e) return false // 起==止：空区间，视作未设（避免"全天勿扰=永远吞通知"的危险歧义）
  const cur = localMinuteOfDay(nowMs, q.tz)
  if (cur == null) return false
  // 不跨午夜（s<e）：[s, e)；跨午夜（s>e，如 22:00→07:00）：[s,1440) ∪ [0,e)。
  return s < e ? (cur >= s && cur < e) : (cur >= s || cur < e)
}

/// 某通知类别是否**无视勿扰、始终推送**（纵深防御：即便将来有紧急/安全类通知误走 notifyUser 也不会被静默）。
/// 当前经 notifyUser/聊天的都是软通知；紧急告警/来电/SOS/安全报到本就走独立扇出、不经勿扰门。此为防御性兜底。
/// 含 checkin|safety：覆盖安全报到自身/过期自通知（safety_checkin_expired）——与本兜底"安全类不被静默"的初衷对齐
/// （对抗复审 LOW#1；当前这些也走独立扇出，此为将来若改走 notifyUser 的保险）。
/// 含 **security**：账号安全变更预警（改密/关 2FA/换邮箱/找回重置=潜在**接管信号**）——若非本人操作，用户须**即时**
/// 察觉才能抢救账号，勿扰中压掉横幅会把接管拖到次日早晨。行业通例（Apple/Google/银行）一律把账号安全告警按
/// time-sensitive 越过勿扰；本人自助改密时的横幅只是可关的轻扰，接管检测价值远大于此。
/// 含 **delivery**：应急投递自测（delivery_check，用户在协助/亲友端主动"测试我的应急告警能不能送达"）——自测的
/// 意义是**验证真实应急投递路径**，而真实应急恒越勿扰；若自测反而遵守勿扰，就测不到真实路径（用户在联系人勿扰
/// 时段自测、向其核对"收到没"会误判链路坏）。故自测也越勿扰真送达（用户拍板，2026-07-11）。它是**低调的测试**
/// 通知（kind=delivery_check，客户端渲染为"测试"、非应急大模态/响铃），送达但不惊扰。
export function isAlwaysThrough(kind: string): boolean {
  return /emergency|sos|\bcall\b|incoming|escalat|alert|checkin|safety|security|delivery/i.test(kind)
}

/// 组合门：该通知此刻是否应**抑制推送横幅**（站内通知仍照常持久化）。
export function shouldSuppressPush(q: QuietHours | undefined, kind: string, nowMs: number): boolean {
  if (isAlwaysThrough(kind)) return false
  return isQuietedNow(q, nowMs)
}
