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
  emergency?: boolean   // 紧急求助（盲人一键 SOS 呼叫亲友）——供被叫端突出显示/优先应答，区别于日常呼叫
  declinedBy?: string[] // 已明确"拒绝"的目标（供发起方看到"对方已拒绝"）
  answeredBy?: string   // 首位接听者（群呼首接抢占：其余目标停止振铃、后接者得到明确反馈）
  answeredAt?: number   // 首接时刻——用于"已认领却接不通"的死锁自愈（见 reopenStaleAnswer）
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

  /// 某发起人当前未过期的待接来电数。用于限制单用户占位、防其用大量 callId 灌满全局 cap、
  /// 把他人(尤其盲人发起的紧急来电)从待接表挤出(被叫前台轮询就看不到→接不通)。
  activeCountFor(fromUserId: string, now: number): number {
    this.prune(now)
    let n = 0
    for (const c of this.calls.values()) if (c.fromUserId === fromUserId) n++
    return n
  }

  /// 返回该 callId 的合法参与者（发起者 + 目标）；未登记则 null。供信令 join 的参与权校验（见审查 #8）。
  /// 传 now 则先清过期（过期条目视为不存在，避免僵尸条目影子覆盖参与权，见审查 #7）。
  participants(callId: string, now?: number): string[] | null {
    if (now !== undefined) this.prune(now)
    const c = this.calls.get(callId)
    if (!c) return null
    return [c.fromUserId, ...c.toUserIds]
  }

  /// 信令**房间**的合法成员：一旦群呼被首接（answeredBy 已定），房间只放行「发起者 + 首接赢家」，
  /// 而非全体目标。否则落败/未接目标可用同一 callId 抢先 join，占掉 1:1 房间的名额，把真正接听的赢家
  /// （或盲人自己）挤在通话外（call_full）——首接抢占在 REST 层生效、却在信令层失效（见协助呼叫可靠性复审）。
  /// 未接听前（answeredBy 未定）仍放行全体目标，因盲人可能先入房等待、任一目标随后接听。
  roomParticipants(callId: string, now?: number): string[] | null {
    if (now !== undefined) this.prune(now)
    const c = this.calls.get(callId)
    if (!c) return null
    return c.answeredBy ? [c.fromUserId, c.answeredBy] : [c.fromUserId, ...c.toUserIds]
  }

  /// 该 callId 是否有未过期登记（供跨注册表冲突检查）。
  hasActive(callId: string, now: number): boolean {
    this.prune(now)
    return this.calls.has(callId)
  }

  /// 返回针对该用户、未过期的待接来电（最近的在前）。
  /// 已被他人接听的呼叫不再出现（群呼首接抢占：其余设备的应用内振铃 3s 内自动消失）。
  incomingFor(userId: string, now: number): PendingCall[] {
    this.prune(now)
    return [...this.calls.values()]
      .filter((c) => c.toUserIds.includes(userId)
        && (c.answeredBy === undefined || c.answeredBy === userId)
        && !(c.declinedBy ?? []).includes(userId)) // 本人已拒绝 → 不再在其设备上重复振铃（发起方仍经 status 看到拒绝）
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /// 接听认领（**首接生效**，原子）：第一位目标接听返回其 userId；之后的接听返回先到者的 userId，
  /// 客户端据此提示"已被其他亲友接听"而非加入失败。非目标返回 null。
  claimAnswer(callId: string, userId: string, now: number): string | null {
    this.prune(now)
    const c = this.calls.get(callId)
    if (!c || !c.toUserIds.includes(userId)) return null
    if (c.answeredBy === undefined) {
      this.calls.set(callId, { ...c, answeredBy: userId, answeredAt: now })
      return userId
    }
    return c.answeredBy
  }

  /// 群呼死锁自愈（见协助呼叫可靠性复审）：接听者 claimAnswer 后必须尽快经 /ws 加入房间；若 answered
  /// 超过 graceMs 仍未出现在房间（App 被杀/切后台/WebRTC 建连失败/只发了 REST 没走信令），说明"已认领
  /// 却接不通"——清空 answeredBy 让呼叫**重新对其余目标振铃**，而非静默死锁到 TTL。isAnswererPresent
  /// 由调用方用 hub 房间成员判定。返回 true 表示本次发生了重开。
  /// graceMs 须 > 正常 answer→join 时延（建议 ~20s，宽松防误伤仍在建连的合法接听者）。
  reopenStaleAnswer(callId: string, now: number, graceMs: number, isAnswererPresent: (userId: string) => boolean): boolean {
    const c = this.calls.get(callId)
    if (!c || c.answeredBy === undefined || c.answeredAt === undefined) return false
    if (now - c.answeredAt <= graceMs) return false        // 仍在建连宽限期内，不动（防误伤正在接通者）
    if (isAnswererPresent(c.answeredBy)) return false        // 赢家确已在房间 → 正常通话中，不动
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { answeredBy: _a, answeredAt: _t, ...rest } = c    // 清空接听态 → 呼叫重新振铃对其余目标可见
    this.calls.set(callId, rest)
    return true
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

  /// 呼叫状态（发起方/后接者轮询）：是否存在、是否全部拒绝、首位接听者。
  status(callId: string, now: number): { exists: boolean; declinedAll: boolean; answeredBy: string | null } {
    this.prune(now)
    const c = this.calls.get(callId)
    if (!c) return { exists: false, declinedAll: false, answeredBy: null }
    const declined = new Set(c.declinedBy ?? [])
    const declinedAll = c.toUserIds.length > 0 && c.toUserIds.every((id) => declined.has(id))
    return { exists: true, declinedAll, answeredBy: c.answeredBy ?? null }
  }

  private prune(now: number): void {
    for (const [id, c] of this.calls) {
      if (now - c.createdAt > this.ttlMs) this.calls.delete(id)
    }
  }

  /// 硬上限：超出则淘汰最旧，防止无界增长（即便无人轮询触发 prune）。
  /// **优先淘汰未接听**的振铃中呼叫（可丢弃：发起方可重拨），仅在未接听全清后仍超限，才动**已接听**的
  /// 呼叫（兜底）——否则积压把一通已接听的紧急来电挤掉，接听者掉线后无法凭 participants 重新加入。
  /// 与 OpenHelpRegistry.cap 同口径（未认领/已认领 ↔ 未接听/已接听）。
  private cap(): void {
    if (this.calls.size < this.maxEntries) return
    const removeCount = this.calls.size - this.maxEntries + 1
    const entries = [...this.calls.entries()]
    const byAge = (a: [string, PendingCall], b: [string, PendingCall]) => a[1].createdAt - b[1].createdAt
    const evictionOrder = [
      ...entries.filter(([, c]) => c.answeredBy === undefined).sort(byAge), // 先淘汰未接听的振铃积压
      ...entries.filter(([, c]) => c.answeredBy !== undefined).sort(byAge), // 兜底：仍超限才动已接听通话
    ]
    for (let i = 0; i < removeCount && i < evictionOrder.length; i++) this.calls.delete(evictionOrder[i][0])
  }

  get size(): number {
    return this.calls.size
  }
}
