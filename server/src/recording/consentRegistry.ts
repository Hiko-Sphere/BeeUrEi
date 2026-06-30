/// 录制知情同意登记（服务端权威，纯逻辑可单测）。
/// 被录方在 App 点"同意录制"时**经鉴权端点**告知服务端；录制登记时由服务端核验"确有非发起者的有效同意"，
/// 而非信任客户端自报的 consentBy——杜绝被改造的客户端伪造对端同意（见 recordings 路由原注释的待办）。
export class RecordingConsentRegistry {
  // callId → (granterUserId → 过期时刻 ms)
  private grants = new Map<string, Map<string, number>>()
  constructor(private ttlMs = 6 * 60 * 60 * 1000) {} // 一次通话的同意有效期（足够覆盖任意时长通话）

  /// 记录一条同意（被录方授予）。
  grant(callId: string, granterId: string, now: number): void {
    this.pruneExpired(now) // 顺手清全表过期项：consenters() 只清被查询的 callId，
                           // 而"授予了同意但该通话从未录制(从不调 consenters)"的项否则永不清除→慢泄漏。grant 调用稀疏，O(n) 可接受。
    let m = this.grants.get(callId)
    if (!m) { m = new Map(); this.grants.set(callId, m) }
    m.set(granterId, now + this.ttlMs)
  }

  /// 清除全表已过期的同意项（及随之变空的 callId 桶）。
  private pruneExpired(now: number): void {
    for (const [cid, m] of this.grants) {
      for (const [uid, exp] of m) if (exp <= now) m.delete(uid)
      if (m.size === 0) this.grants.delete(cid)
    }
  }

  /// 撤回同意（被录方点"不录制"或反悔）。
  revoke(callId: string, granterId: string): void {
    this.grants.get(callId)?.delete(granterId)
  }

  /// 返回该通话中**除 exceptUserId（发起者）外**仍有效的同意者 id 列表（顺带清过期）。
  consenters(callId: string, exceptUserId: string, now: number): string[] {
    const m = this.grants.get(callId)
    if (!m) return []
    const out: string[] = []
    for (const [uid, exp] of [...m]) {
      if (exp <= now) { m.delete(uid); continue }
      if (uid !== exceptUserId) out.push(uid)
    }
    if (m.size === 0) this.grants.delete(callId)
    return out
  }

  get size(): number { return this.grants.size }
}
