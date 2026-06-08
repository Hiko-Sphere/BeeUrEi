/// 待接来电登记表（纯逻辑，可单测）：视障侧发起紧急呼叫时登记 {callId, 目标用户}，
/// 在线的协助者/亲友通过轮询 /api/assist/incoming 发现并加入该 callId——
/// 在没有 APNs 推送(外部依赖)时也能让远程协助在**前台**真正接通。短 TTL 自动过期。
///
/// 安全：register 拒绝覆盖他人的 callId、cancel 需归属校验、容量有硬上限（见审查 rendezvous #2/#3/#4）。
export interface PendingCall {
  callId: string
  fromUserId: string
  fromName: string
  toUserIds: string[]
  createdAt: number
}

export class PendingCallRegistry {
  private calls = new Map<string, PendingCall>()

  constructor(
    private readonly ttlMs = 60_000,
    private readonly maxEntries = 1000,
  ) {}

  /// 登记。若该 callId 已被**他人**占用则拒绝（返回 false），防止覆盖/劫持他人会合。
  register(call: PendingCall): boolean {
    const existing = this.calls.get(call.callId)
    if (existing && existing.fromUserId !== call.fromUserId) return false
    this.prune(call.createdAt)
    this.cap()
    this.calls.set(call.callId, call)
    return true
  }

  /// 返回针对该用户、未过期的待接来电（最近的在前）。
  incomingFor(userId: string, now: number): PendingCall[] {
    this.prune(now)
    return [...this.calls.values()]
      .filter((c) => c.toUserIds.includes(userId))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /// 取消：仅发起人或目标之一可取消（归属校验，防止任意用户压制他人求助）。
  cancel(callId: string, requesterId: string): boolean {
    const c = this.calls.get(callId)
    if (!c) return false
    if (c.fromUserId !== requesterId && !c.toUserIds.includes(requesterId)) return false
    this.calls.delete(callId)
    return true
  }

  private prune(now: number): void {
    for (const [id, c] of this.calls) {
      if (now - c.createdAt > this.ttlMs) this.calls.delete(id)
    }
  }

  /// 硬上限：超出则淘汰最旧，防止无界增长（即便无人轮询触发 prune）。
  private cap(): void {
    if (this.calls.size < this.maxEntries) return
    const oldestFirst = [...this.calls.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)
    const removeCount = this.calls.size - this.maxEntries + 1
    for (let i = 0; i < removeCount; i++) this.calls.delete(oldestFirst[i][0])
  }

  get size(): number {
    return this.calls.size
  }
}
