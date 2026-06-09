/// 公开求助队列（纯逻辑，可单测）：视障用户向**陌生志愿者**广播一条求助请求，
/// 在线志愿者通过 /api/assist/help/queue 浏览、挑选（claim）或随机/偏好匹配（matchOne）。
/// 与 pendingCalls（面向已绑定亲友的定向呼叫）平行：这里是面向开放志愿者池的众包协助。
///
/// 安全/隐私：
/// - register 拒绝覆盖他人的 callId（防劫持会合，同 pendingCalls #2）。
/// - 队列条目只暴露**粗粒度**信息（显示名 / 第一语言 / 城市级地点 / 求助内容简述 / 等待时长），
///   不含精确坐标或联系方式。
/// - claim 为原子操作：一条求助只能被一位志愿者认领，避免两人同时接同一个人。
/// - 未认领条目按 TTL 过期（避免陈旧求助滞留）；已认领条目保留较久（供通话期间 ws 参与权校验），
///   最终由取消/放弃或硬上限淘汰。
export interface HelpRequest {
  callId: string
  fromUserId: string
  fromName: string
  language?: string // 求助者第一语言（如 'zh'/'en'）
  locality?: string // 城市/区级地点（端侧反查后上报，非精确地址）
  topic?: string // 求助内容简述（可选）
  createdAt: number
  claimedBy?: string // 认领该求助的志愿者 userId（认领后从公开队列移除）
  claimedAt?: number
  requeuedAt?: number // 志愿者放弃认领、释放回队列的时刻；过期以此为基准（避免长通话后释放被立即清除，见审查 #6）
}

export interface HelpMatchPrefs {
  preferredLanguage?: string
  requireLanguageMatch?: boolean // 为真时只匹配语言一致的求助；无匹配返回 null
}

/// 队列对外的安全摘要（不含 fromUserId 以外的敏感信息；fromUserId 供 UI 去重，不展示）。
export interface HelpSummary {
  callId: string
  fromName: string
  language?: string
  locality?: string
  topic?: string
  waitedSeconds: number
}

export class OpenHelpRegistry {
  private reqs = new Map<string, HelpRequest>()
  // 跨注册表冲突检查：该 callId 是否已被另一类会话(定向亲友呼叫)占用（见审查 #1）。
  private conflictCheck?: (callId: string, now: number) => boolean

  constructor(
    private readonly ttlMs = 120_000, // 未认领求助 2 分钟无人接即过期
    private readonly claimedTtlMs = 4 * 60 * 60 * 1000, // 已认领条目最长保留 4 小时（兜底清理）
    private readonly maxEntries = 1000,
  ) {}

  setConflictCheck(fn: (callId: string, now: number) => boolean): void {
    this.conflictCheck = fn
  }

  /// 登记一条公开求助。若该 callId 已被**他人且未过期**占用、或已被另一注册表占用，则拒绝（防覆盖/劫持/影子覆盖）。
  register(req: HelpRequest): boolean {
    this.prune(req.createdAt)
    if (this.conflictCheck?.(req.callId, req.createdAt)) return false // 跨表去重（见审查 #1）
    const existing = this.reqs.get(req.callId)
    if (existing && existing.fromUserId !== req.fromUserId) return false
    this.cap()
    this.reqs.set(req.callId, req)
    return true
  }

  byId(callId: string): HelpRequest | undefined {
    return this.reqs.get(callId)
  }

  /// 公开队列：未认领、未过期，按等待时间（最久优先）。可排除某用户（通常是请求者本人）。
  open(now: number, excludeUserId?: string): HelpRequest[] {
    this.prune(now)
    return [...this.reqs.values()]
      .filter((r) => !r.claimedBy && r.fromUserId !== excludeUserId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /// 队列的安全摘要视图（供 GET /queue 直接返回）。
  summaries(now: number, excludeUserId?: string): HelpSummary[] {
    return this.open(now, excludeUserId).map((r) => ({
      callId: r.callId,
      fromName: r.fromName,
      language: r.language,
      locality: r.locality,
      topic: r.topic,
      waitedSeconds: Math.max(0, Math.floor((now - r.createdAt) / 1000)),
    }))
  }

  /// 原子认领指定求助：未过期 + 未被他人认领 才成功；不能认领自己的求助。
  /// 已被自己认领则幂等返回（重入安全）。返回认领后的完整请求，或 null（不可认领）。
  claim(callId: string, helperId: string, now: number): HelpRequest | null {
    this.prune(now)
    const r = this.reqs.get(callId)
    if (!r) return null
    if (r.fromUserId === helperId) return null // 不能认领自己的求助
    if (r.claimedBy && r.claimedBy !== helperId) return null // 已被他人认领
    const claimed: HelpRequest = { ...r, claimedBy: helperId, claimedAt: now }
    this.reqs.set(callId, claimed)
    return claimed
  }

  /// 随机/偏好匹配一条并直接认领。
  /// - requireLanguageMatch 时只在语言一致的求助里挑，否则全队列。
  /// - preferredLanguage 给定时，语言一致者优先；其次等待最久者优先。
  /// 返回认领后的请求，无可匹配/认领竞争失败则返回 null。
  matchOne(prefs: HelpMatchPrefs, helperId: string, now: number): HelpRequest | null {
    const candidates = this.open(now, helperId)
    const pool =
      prefs.requireLanguageMatch && prefs.preferredLanguage
        ? candidates.filter((r) => r.language === prefs.preferredLanguage)
        : candidates
    if (pool.length === 0) return null
    // open() 已按等待时间升序（最久优先）；稳定排序把偏好语言提到前面而不打乱等待顺序。
    const ranked = prefs.preferredLanguage
      ? [...pool].sort(
          (a, b) =>
            Number(b.language === prefs.preferredLanguage) - Number(a.language === prefs.preferredLanguage),
        )
      : pool
    // 逐个尝试认领，避免与并发 claim 竞争失败时直接放弃（取下一个可认领者）。
    for (const r of ranked) {
      const claimed = this.claim(r.callId, helperId, now)
      if (claimed) return claimed
    }
    return null
  }

  /// 参与权（供 ws join 校验）：求助者本人始终是参与者；认领后追加认领者。未登记返回 null。
  /// 传 now 则先清过期（过期条目视为不存在，避免僵尸条目影子覆盖参与权，见审查 #7）。
  participants(callId: string, now?: number): string[] | null {
    if (now !== undefined) this.prune(now)
    const r = this.reqs.get(callId)
    if (!r) return null
    return r.claimedBy ? [r.fromUserId, r.claimedBy] : [r.fromUserId]
  }

  /// 该 callId 是否有未过期登记（供跨注册表冲突检查）。
  hasActive(callId: string, now: number): boolean {
    this.prune(now)
    return this.reqs.has(callId)
  }

  /// 取消/放弃（归属校验，防越权压制他人求助）：
  /// - 求助者取消 → 删整条；
  /// - 认领者放弃 → 清除 claimedBy，**释放回公开队列**让别的志愿者接手。
  cancel(callId: string, requesterId: string, now: number = 0): boolean {
    const r = this.reqs.get(callId)
    if (!r) return false
    if (r.fromUserId === requesterId) {
      this.reqs.delete(callId)
      return true
    }
    if (r.claimedBy === requesterId) {
      // 释放回队列：保留原 createdAt 以维持排队位置（防放弃者反复 claim/release 顶队首），
      // 但用 requeuedAt=now 作为**过期基准**——否则长通话(>ttl)后放弃会因 createdAt 陈旧被立即清除，
      // 求助凭空消失而非回到队列（见审查 #6）。
      this.reqs.set(callId, { ...r, claimedBy: undefined, claimedAt: undefined, requeuedAt: now })
      return true
    }
    return false
  }

  private prune(now: number): void {
    for (const [id, r] of this.reqs) {
      // 未认领条目以 requeuedAt(若曾释放)否则 createdAt 为基准计过期；已认领条目以 claimedAt 计。
      const expired = r.claimedBy
        ? r.claimedAt !== undefined && now - r.claimedAt > this.claimedTtlMs
        : now - (r.requeuedAt ?? r.createdAt) > this.ttlMs
      if (expired) this.reqs.delete(id)
    }
  }

  /// 硬上限：超出则淘汰最旧，防止无界增长（即便无人触发 prune）。
  private cap(): void {
    if (this.reqs.size < this.maxEntries) return
    const oldestFirst = [...this.reqs.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)
    const removeCount = this.reqs.size - this.maxEntries + 1
    for (let i = 0; i < removeCount; i++) this.reqs.delete(oldestFirst[i][0])
  }

  get size(): number {
    return this.reqs.size
  }
}
