/// 验证码「发送侧」节流（防连点 / 防短信轰炸式邮件骚扰）。与 CodeRegistry（校验侧限次）互补。
/// 规则：同一收件人 ① 两次发送至少间隔 `cooldownMs`（默认 60 秒）；
///       ② 滑动窗口 `windowMs`（默认 1 小时）内最多发送 `maxPerWindow`（默认 5）次，超过则拒绝、让其稍后再试。
/// 纯内存、可单测（注入 now）。重启即清空——验证码寿命短，可接受（与 CodeRegistry 一致）。
export type SendDecision =
  | { ok: true }
  | { ok: false; reason: 'cooldown' | 'too_many'; retryAfterSec: number }

export class CodeSendLimiter {
  private readonly hits = new Map<string, number[]>() // key → 窗口内发送时间戳（升序）

  constructor(
    private readonly cooldownMs = 60_000,
    private readonly windowMs = 60 * 60_000,
    private readonly maxPerWindow = 5,
  ) {}

  private recent(key: string, now: number): number[] {
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
  }

  /// 是否允许发送（不改状态）。
  check(key: string, now: number): SendDecision {
    const arr = this.recent(key, now)
    if (arr.length > 0) {
      const sinceLast = now - arr[arr.length - 1]
      if (sinceLast < this.cooldownMs) {
        return { ok: false, reason: 'cooldown', retryAfterSec: Math.ceil((this.cooldownMs - sinceLast) / 1000) }
      }
      if (arr.length >= this.maxPerWindow) {
        // 等最早一次滑出窗口后才放行。
        return { ok: false, reason: 'too_many', retryAfterSec: Math.ceil((this.windowMs - (now - arr[0])) / 1000) }
      }
    }
    return { ok: true }
  }

  /// 记录一次「成功发送」。发送失败（SMTP 故障）不应记录，以免误把用户锁在冷却里。
  record(key: string, now: number): void {
    const arr = this.recent(key, now)
    arr.push(now)
    this.hits.set(key, arr)
    // 机会式清理：窗口内已无记录的 key 直接移除，避免长期累积空键。
    if (this.hits.size > 5_000) {
      for (const [k, v] of this.hits) if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k)
    }
  }

  /// 原子「占额」：check 通过则**同步立即** record，返回决定。用于消除「check → await 发信 → record」
  /// 之间的并发 TOCTOU——原写法并发连发会在 record 落库前都过 check，绕过冷却。tryConsume 同步完成
  /// check+record，故并发的第二个请求必看到第一个的记录而被冷却挡下（只放行一个）。
  tryConsume(key: string, now: number): SendDecision {
    const dec = this.check(key, now)
    if (dec.ok) this.record(key, now)
    return dec
  }

  /// 退还一次刚 tryConsume 占用的额度：发信失败时调用，保持「发信失败不锁冷却」语义。
  /// 移除该 key 在 now 记的那一条（因冷却，同一 key 同一 now 至多一条 tryConsume 成功，故无歧义）。
  refund(key: string, now: number): void {
    const arr = this.hits.get(key)
    if (!arr) return
    const i = arr.lastIndexOf(now)
    if (i >= 0) arr.splice(i, 1)
    if (arr.length === 0) this.hits.delete(key)
  }

  get size(): number {
    return this.hits.size
  }
}
