/// 实时位置共享登记（**纯内存**，刻意不落库——只保留"当前位置"，绝不持久化轨迹，最小化隐私足迹）。
/// 用户开启共享后周期上报位置，可见给其"已接受"绑定的亲友/协助者；停止共享或过期/陈旧即不可见。
/// 与 PresenceRegistry 同构：内存 Map + TTL，纯逻辑可单测，规模化可换 Redis。
export interface LiveLocation {
  lat: number
  lng: number
  accuracy?: number   // 水平精度（米）
  heading?: number    // 行进方向（度，0–360）
  updatedAt: number   // 服务器接收时刻(ms)
  sharingUntil: number // 共享有效期截止(ms)；超过即视为停止共享
}

export class LiveLocationRegistry {
  private map = new Map<string, LiveLocation>()

  /// freshMs：超过此时长无新位置则视为"陈旧"不可见（共享中但客户端断流时不暴露旧坐标）。
  /// maxTtlMs：单次共享最长有效期（防止"忘记关"无限期暴露位置）。
  constructor(private freshMs = 90_000, private maxTtlMs = 60 * 60_000) {}

  /// 上报位置 + （重）激活共享，返回本次共享截止时刻。ttlMs 缺省/超限取 maxTtlMs。
  update(userId: string, p: { lat: number; lng: number; accuracy?: number; heading?: number }, now: number, ttlMs?: number): number {
    const ttl = Math.min(Math.max(Number.isFinite(ttlMs) ? (ttlMs as number) : this.maxTtlMs, 0), this.maxTtlMs)
    const sharingUntil = now + ttl
    this.map.set(userId, { lat: p.lat, lng: p.lng, accuracy: p.accuracy, heading: p.heading, updatedAt: now, sharingUntil })
    this.prune(now)
    return sharingUntil
  }

  /// 立即停止共享（删除记录——之后任何查询都不可见）。
  stop(userId: string): void { this.map.delete(userId) }

  /// 是否正在共享（未过期）。
  isSharing(userId: string, now: number): boolean {
    const l = this.map.get(userId)
    return !!l && l.sharingUntil > now
  }

  /// 共享截止时刻（未在共享则 0）。
  sharingUntil(userId: string, now: number): number {
    const l = this.map.get(userId)
    return l && l.sharingUntil > now ? l.sharingUntil : 0
  }

  /// 该用户**当前可见**位置（须仍在共享且新鲜），否则 undefined。授权（谁能看）由调用方据绑定关系判定。
  visible(userId: string, now: number): LiveLocation | undefined {
    const l = this.map.get(userId)
    if (!l || l.sharingUntil <= now || now - l.updatedAt > this.freshMs) return undefined
    return l
  }

  /// 清理已过期记录，内存有界。
  private prune(now: number): void {
    for (const [u, l] of this.map) if (l.sharingUntil <= now) this.map.delete(u)
  }
}
