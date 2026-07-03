/// 按账号的登录节流（NIST 800-63B：限制对单一账号的连续失败尝试）。
///
/// 现有限流按 IP/sub——分布式撞库（换 IP 打同一账号）无感。本节流按**账号**记连续失败：
/// - 连续失败 < softThreshold：不干预（正常输错几次不受罚）；
/// - ≥ softThreshold：**递进延迟**——两次尝试之间须隔 delayMs（把撞库限到 ~2 次/分钟，
///   字典攻击不可行），而非硬锁死（硬锁 = 攻击者可用错误密码把受害者永久锁在门外）；
/// - ≥ hardThreshold（NIST 上限 100 之内）：冷却 cooldownMs。
///
/// 关键语义：
/// - **节流对密码正确与否一视同仁**——延迟窗口内即便密码正确也 429：否则撞库者猜中即进，
///   节流形同虚设。受害者最多等一个 delay 窗口；且 passkey / 邮箱验证码登录不走此表，永远可用。
/// - 成功登录（延迟窗口外）即清零——正常用户偶尔输错不累积。
/// - 纯内存：重启清零可接受（撞库须重新累积；比漏防好）。LRU 有界防内存放大。
export interface ThrottleDecision {
  allowed: boolean
  retryAfterMs?: number
}

export class LoginThrottle {
  private entries = new Map<string, { fails: number; lastAttemptAt: number }>()

  constructor(
    private readonly softThreshold = 10,
    private readonly delayMs = 30_000,
    private readonly hardThreshold = 50,
    private readonly cooldownMs = 15 * 60_000,
    private readonly maxEntries = 10_000,
  ) {}

  /// 每次登录尝试**前**调用：本次是否放行。放行时会记下尝试时刻（作为下一次的间隔基准）。
  check(key: string, now: number): ThrottleDecision {
    const e = this.entries.get(key)
    if (!e || e.fails < this.softThreshold) return { allowed: true }
    const gap = e.fails >= this.hardThreshold ? this.cooldownMs : this.delayMs
    const wait = e.lastAttemptAt + gap - now
    if (wait > 0) return { allowed: false, retryAfterMs: wait }
    e.lastAttemptAt = now // 放行的这次尝试成为新的间隔基准（失败与否由 record* 更新计数）
    return { allowed: true }
  }

  recordFailure(key: string, now: number): void {
    const e = this.entries.get(key)
    if (e) {
      e.fails++
      e.lastAttemptAt = now
    } else {
      if (this.entries.size >= this.maxEntries) {
        // LRU 近似：删最老插入（Map 迭代序）。有界防"海量账号名"内存放大。
        const first = this.entries.keys().next().value
        if (first !== undefined) this.entries.delete(first)
      }
      this.entries.set(key, { fails: 1, lastAttemptAt: now })
    }
  }

  recordSuccess(key: string): void {
    this.entries.delete(key)
  }
}
