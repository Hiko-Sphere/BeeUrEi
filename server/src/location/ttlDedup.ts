/// 按 key 的 TTL 去重（防重复打扰，如"请求对方共享位置"的 nudge：同一 请求者→目标 5 分钟内只发一次）。
///
/// 关键是**有界**：key 空间是"用户对"（`${me}:${target}`），若只增不减，长运行服务会随累积的不同对无限膨胀，
/// 而每条记录过了 ttlMs 就毫无意义。故超过 maxEntries 时机会式清理一遍 TTL 外的陈旧条目
/// （与 CodeSendLimiter/LoginThrottle 的清理惯例一致）。纯内存、可注入 now 单测；重启即清（去重窗口短，可接受）。
export class TtlDedup {
  private readonly seen = new Map<string, number>() // key → 上次放行时刻 ms

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 5_000,
  ) {}

  /// 首次、或距上次放行已超过 ttlMs → 记录本次并返回 true（放行）；ttlMs 内重复 → 返回 false（去重、不打扰）。
  tryPass(key: string, now: number): boolean {
    const last = this.seen.get(key)
    if (last != null && now - last < this.ttlMs) return false
    this.seen.set(key, now)
    // 机会式清理：仅在超阈值时扫一遍（O(n) 但不常触发），删除 TTL 外已无意义的条目，防"用户对"无限累积。
    if (this.seen.size > this.maxEntries) {
      for (const [k, ts] of this.seen) if (now - ts >= this.ttlMs) this.seen.delete(k)
    }
    return true
  }

  /// TTL 内 key 形如 `<requester>:${suffix}` 的所有 `<requester>`（反向查找"谁在窗口内请求过 target 共享位置"，
  /// 用于对方开始共享时反馈请求者）。用户 id 为 UUID、不含 ':'，故按尾串 `:${suffix}` 精确切分安全。
  requestersFor(suffix: string, now: number): string[] {
    const tail = `:${suffix}`
    const out: string[] = []
    for (const [k, ts] of this.seen) {
      if (now - ts >= this.ttlMs) continue
      if (k.endsWith(tail)) out.push(k.slice(0, -tail.length))
    }
    return out
  }

  /// 清除一个 key（已反馈请求者后清，避免同一请求重复反馈；清后请求者可在对方停止共享后再次请求）。
  clear(key: string): void { this.seen.delete(key) }

  get size(): number {
    return this.seen.size
  }
}
