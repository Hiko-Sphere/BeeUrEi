/// 协助者/亲友"在线待命"存在表（内存；规模化可换 Redis）。
/// 客户端定期心跳；超过 TTL 无心跳即视为离线。纯逻辑，可单测。
export class PresenceRegistry {
  private last = new Map<string, number>()    // userId → 最近一次"可用"心跳的服务器时间(ms，用于 TTL)
  private lastSeq = new Map<string, number>() // userId → 最近一次已应用心跳的**客户端时间戳**(用于顺序)

  constructor(private ttlMs: number = 45_000) {}

  /// seq 为客户端发起时刻(ms)；用于忽略乱序到达的过期心跳——否则切页时滞后到达的
  /// available:false 会把刚回前台的在线亲友错误标记为离线，紧急匹配漏人(见审查 #1)。
  heartbeat(userId: string, available: boolean, now: number, seq: number = now): void {
    const prev = this.lastSeq.get(userId)
    if (prev !== undefined && seq < prev) return // 过期/乱序心跳：丢弃
    this.lastSeq.set(userId, seq)
    if (available) this.last.set(userId, now)
    else this.last.delete(userId)
  }

  isAvailable(userId: string, now: number): boolean {
    const t = this.last.get(userId)
    return t !== undefined && now - t <= this.ttlMs
  }

  availableUserIds(now: number): Set<string> {
    const s = new Set<string>()
    for (const [u, t] of this.last) if (now - t <= this.ttlMs) s.add(u)
    return s
  }
}
