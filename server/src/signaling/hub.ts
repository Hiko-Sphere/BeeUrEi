/// 信令房间逻辑（纯，可单测）。socket 传输在 routes/ws.ts 适配。
/// 1:1 呼叫：一个 callId 房间内最多两端（视障 caller + 协助者 callee）。
export interface Member {
  clientId: string
  userId: string
  role: string
  callId: string
  joinedAt?: number // 加入房间时刻（ms）；用于活跃通话"已通话时长"。register 时由 ws 层补。
  caps?: string[]   // 客户端能力位（如 'adminObserver'）；仅当房间所有参与者都支持时才允许管理员旁观，保护旧版 App。
}

/// 一通进行中的通话（供管理员实时总览）。
export interface ActiveCall {
  callId: string
  startedAt: number          // 最早成员加入时刻
  members: { userId: string; role: string }[]
  hasAdminObserver: boolean  // 是否已有管理员在监看
}

export class SignalingHub {
  private members = new Map<string, Member>()

  /// 加入房间，返回同房间的其他成员（用于相互通知 + 转发目标）。
  join(member: Member): Member[] {
    this.members.set(member.clientId, member)
    return this.peersInCall(member.callId, member.clientId)
  }

  /// 所有进行中的通话（按 callId 聚合），按开始时间倒序。供管理员实时总览。
  activeCalls(): ActiveCall[] {
    const byCall = new Map<string, Member[]>()
    for (const m of this.members.values()) {
      const arr = byCall.get(m.callId) ?? []
      arr.push(m)
      byCall.set(m.callId, arr)
    }
    const out: ActiveCall[] = []
    for (const [callId, ms] of byCall) {
      const startedAt = Math.min(...ms.map((m) => m.joinedAt ?? 0))
      out.push({
        callId, startedAt,
        members: ms.map((m) => ({ userId: m.userId, role: m.role })),
        hasAdminObserver: ms.some((m) => m.role === 'admin'),
      })
    }
    return out.sort((a, b) => b.startedAt - a.startedAt)
  }

  /// 离开，返回被移除的成员与房间内剩余成员。
  leave(clientId: string): { member?: Member; peers: Member[] } {
    const member = this.members.get(clientId)
    if (!member) return { peers: [] }
    this.members.delete(clientId)
    return { member, peers: this.peersInCall(member.callId) }
  }

  peersInCall(callId: string, exceptClientId?: string): Member[] {
    return [...this.members.values()].filter((m) => m.callId === callId && m.clientId !== exceptClientId)
  }

  isOnline(userId: string): boolean {
    for (const m of this.members.values()) if (m.userId === userId) return true
    return false
  }

  onlineUserIds(): Set<string> {
    return new Set([...this.members.values()].map((m) => m.userId))
  }

  /// 该用户当前在多少个房间（≈进行中的通话数，用于负载均衡匹配）。
  callCount(userId: string): number {
    let n = 0
    for (const m of this.members.values()) if (m.userId === userId) n++
    return n
  }

  get size(): number {
    return this.members.size
  }
}
