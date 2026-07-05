/// 协助者/亲友"在线待命"存在表（内存；规模化可换 Redis）。
/// 客户端定期心跳；超过 TTL 无心跳即视为离线。纯逻辑，可单测。
export class PresenceRegistry {
  // userId → 心跳状态。单表存 seq(乱序去抖) + seenAt(服务器时间，用于安全剪枝) + availableAt(最近一次可用的服务器时间)。
  // 用**单表**而非两表：旧实现的 lastSeq 每次心跳都 set、却**永不删**（每个曾心跳过的 userId 常驻一条 → 无界增长/内存泄漏）；
  // last 也会为"不发 available:false 就断线"的用户留下 TTL 陈旧条目永不清。合并后由 seenAt 统一剪枝。
  private state = new Map<string, { seq: number; seenAt: number; availableAt: number | null }>()

  /// pruneGraceMs：条目最后一次心跳距今超过此值才可剪（默认 10 分钟，远大于任何真实网络往返）——保证被剪的条目
  /// 绝不会有"在途的滞后心跳"还要靠它的 seq 去抖（否则剪掉正在切页用户的 seq 会重开审查#1 的乱序 bug）。
  /// pruneThreshold：表规模超此才做机会式清扫（小部署永不触发，本就有界）。
  constructor(private ttlMs = 45_000, private pruneGraceMs = 600_000, private pruneThreshold = 10_000) {}

  /// seq 为客户端发起时刻(ms)；用于忽略乱序到达的过期心跳——否则切页时滞后到达的
  /// available:false 会把刚回前台的在线亲友错误标记为离线，紧急匹配漏人(见审查 #1)。
  heartbeat(userId: string, available: boolean, now: number, seq: number = now): void {
    // seq 由客户端提供，夹取到 [0, now+60s]：否则恶意超大 seq 会让该用户后续所有合法心跳(seq<巨值)被丢弃，
    // 把自己永久"钉"在某一状态(如常驻在线却不应答紧急呼叫)，污染紧急匹配（见审查 #9）。
    const boundedSeq = Math.min(Math.max(Number.isFinite(seq) ? seq : now, 0), now + 60_000)
    const prev = this.state.get(userId)
    if (prev !== undefined && boundedSeq < prev.seq) return // 过期/乱序心跳：丢弃
    this.state.set(userId, { seq: boundedSeq, seenAt: now, availableAt: available ? now : null })
    this.pruneIfLarge(now)
  }

  isAvailable(userId: string, now: number): boolean {
    const e = this.state.get(userId)
    return e?.availableAt != null && now - e.availableAt <= this.ttlMs
  }

  availableUserIds(now: number): Set<string> {
    const s = new Set<string>()
    for (const [u, e] of this.state) if (e.availableAt != null && now - e.availableAt <= this.ttlMs) s.add(u)
    return s
  }

  /// 当前表规模（含尚未剪除的陈旧条目）——供监控/测试。
  get size(): number { return this.state.size }

  /// 机会式清扫：表大到阈值时，删除最后心跳早于 pruneGraceMs 的条目（seenAt 为**服务器**时间，安全）。
  /// 刚写入的当前用户 seenAt=now，绝不会被本轮剪掉。
  private pruneIfLarge(now: number): void {
    if (this.state.size <= this.pruneThreshold) return
    for (const [u, e] of this.state) if (now - e.seenAt > this.pruneGraceMs) this.state.delete(u)
  }
}
