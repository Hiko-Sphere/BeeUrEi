/// 协助者/亲友"在线待命"存在表（内存；规模化可换 Redis）。
/// 客户端定期心跳；超过 TTL 无心跳即视为离线。纯逻辑，可单测。
export class PresenceRegistry {
  private last = new Map<string, number>() // userId → 最近一次"可用"心跳时间(ms)

  constructor(private ttlMs: number = 45_000) {}

  heartbeat(userId: string, available: boolean, now: number): void {
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
