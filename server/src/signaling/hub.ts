/// 信令房间逻辑（纯，可单测）。socket 传输在 routes/ws.ts 适配。
/// 1:1 呼叫：一个 callId 房间内最多两端（视障 caller + 协助者 callee）。
export interface Member {
  clientId: string
  userId: string
  role: string
  callId: string
}

export class SignalingHub {
  private members = new Map<string, Member>()

  /// 加入房间，返回同房间的其他成员（用于相互通知 + 转发目标）。
  join(member: Member): Member[] {
    this.members.set(member.clientId, member)
    return this.peersInCall(member.callId, member.clientId)
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

  get size(): number {
    return this.members.size
  }
}
