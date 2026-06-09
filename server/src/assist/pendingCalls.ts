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
  declinedBy?: string[] // 已明确"拒绝"的目标（供发起方看到"对方已拒绝"）
}

export class PendingCallRegistry {
  private calls = new Map<string, PendingCall>()
  // 跨注册表冲突检查：该 callId 是否已被另一类会话(公开求助)占用。防同名 callId 影子覆盖参与权（见审查 #1/#7）。
  private conflictCheck?: (callId: string, now: number) => boolean

  constructor(
    // 响铃/待接听窗口：亲友可能不在手机旁，60s 太短会把晚接听的合法亲友锁在自己该接的紧急来电外（见复审 #4）。
    private readonly ttlMs = 180_000,
    private readonly maxEntries = 1000,
  ) {}

  setConflictCheck(fn: (callId: string, now: number) => boolean): void {
    this.conflictCheck = fn
  }

  /// 登记。若该 callId 已被**他人且未过期**占用、或已被另一注册表占用，则拒绝（返回 false），防覆盖/劫持/影子覆盖。
  register(call: PendingCall): boolean {
    this.prune(call.createdAt) // 先清过期：否则他人的"僵尸"过期条目会一直阻挡合法登记(callId 占位 DoS，见审查 #4)
    if (this.conflictCheck?.(call.callId, call.createdAt)) return false // 跨表去重（见审查 #1）
    const existing = this.calls.get(call.callId)
    if (existing && existing.fromUserId !== call.fromUserId) return false
    this.cap()
    this.calls.set(call.callId, call)
    return true
  }

  /// 返回该 callId 的合法参与者（发起者 + 目标）；未登记则 null。供信令 join 的参与权校验（见审查 #8）。
  /// 传 now 则先清过期（过期条目视为不存在，避免僵尸条目影子覆盖参与权，见审查 #7）。
  participants(callId: string, now?: number): string[] | null {
    if (now !== undefined) this.prune(now)
    const c = this.calls.get(callId)
    if (!c) return null
    return [c.fromUserId, ...c.toUserIds]
  }

  /// 该 callId 是否有未过期登记（供跨注册表冲突检查）。
  hasActive(callId: string, now: number): boolean {
    this.prune(now)
    return this.calls.has(callId)
  }

  /// 返回针对该用户、未过期的待接来电（最近的在前）。
  incomingFor(userId: string, now: number): PendingCall[] {
    this.prune(now)
    return [...this.calls.values()]
      .filter((c) => c.toUserIds.includes(userId))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /// 取消（归属校验，防止任意用户压制他人求助）：
  /// - 发起人取消 → 删整条；
  /// - 某个目标取消 → 只把自己从 toUserIds 移除（仅当无剩余目标才删整条），
  ///   不影响对其他在线亲友的群呼（见审查 #5）。
  cancel(callId: string, requesterId: string): boolean {
    const c = this.calls.get(callId)
    if (!c) return false
    if (c.fromUserId === requesterId) {
      this.calls.delete(callId)
      return true
    }
    if (c.toUserIds.includes(requesterId)) {
      const remaining = c.toUserIds.filter((id) => id !== requesterId)
      if (remaining.length === 0) this.calls.delete(callId)
      else this.calls.set(callId, { ...c, toUserIds: remaining })
      return true
    }
    return false
  }

  /// 目标"拒绝"来电（区别于取消/超时）。仅目标本人有效。保留登记，供发起方轮询看到拒绝。
  decline(callId: string, userId: string, now: number): boolean {
    this.prune(now)
    const c = this.calls.get(callId)
    if (!c || !c.toUserIds.includes(userId)) return false
    const set = new Set(c.declinedBy ?? [])
    set.add(userId)
    this.calls.set(callId, { ...c, declinedBy: [...set] })
    return true
  }

  /// 呼叫状态（发起方轮询）：是否存在、是否所有目标都已拒绝。
  status(callId: string, now: number): { exists: boolean; declinedAll: boolean } {
    this.prune(now)
    const c = this.calls.get(callId)
    if (!c) return { exists: false, declinedAll: false }
    const declined = new Set(c.declinedBy ?? [])
    const declinedAll = c.toUserIds.length > 0 && c.toUserIds.every((id) => declined.has(id))
    return { exists: true, declinedAll }
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
