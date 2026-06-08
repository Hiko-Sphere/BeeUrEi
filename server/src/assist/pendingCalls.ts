/// 待接来电登记表（纯逻辑，可单测）：视障侧发起紧急呼叫时登记 {callId, 目标用户}，
/// 在线的协助者/亲友通过轮询 /api/assist/incoming 发现并加入该 callId——
/// 在没有 APNs 推送(外部依赖)时也能让远程协助在**前台**真正接通。短 TTL 自动过期。
export interface PendingCall {
  callId: string
  fromUserId: string
  fromName: string
  toUserIds: string[]
  createdAt: number
}

export class PendingCallRegistry {
  private calls = new Map<string, PendingCall>()

  constructor(private readonly ttlMs = 60_000) {}

  register(call: PendingCall): void {
    this.calls.set(call.callId, call)
  }

  /// 返回针对该用户、未过期的待接来电（最近的在前）。
  incomingFor(userId: string, now: number): PendingCall[] {
    this.prune(now)
    return [...this.calls.values()]
      .filter((c) => c.toUserIds.includes(userId))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  cancel(callId: string): void {
    this.calls.delete(callId)
  }

  private prune(now: number): void {
    for (const [id, c] of this.calls) {
      if (now - c.createdAt > this.ttlMs) this.calls.delete(id)
    }
  }

  get size(): number {
    return this.calls.size
  }
}
