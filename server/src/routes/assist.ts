import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, isBlockedBetween, blockedUserIdSet, matchBannedTerm, acceptedContactIds } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { SignalingHub } from '../signaling/hub'
import { PresenceRegistry } from '../assist/presence'
import { rankHelpers, type Candidate } from '../assist/matcher'
import { buildIceServers } from '../assist/turnCredentials'
import { PendingCallRegistry } from '../assist/pendingCalls'
import { pushLang, pushStrings } from '../push/pushStrings'
import { OpenHelpRegistry } from '../assist/openHelp'
import { type PushSender } from '../push/apns'
import { type Metrics } from '../metrics/metrics'

const heartbeatSchema = z.object({ available: z.boolean(), at: z.number().optional() })
const matchSchema = z.object({ emergency: z.boolean().optional(), preferredLanguage: z.string().optional() })
const callSchema = z.object({ callId: z.string().min(1).max(128), targetUserIds: z.array(z.string().min(1)).min(1).max(20) })
// 公开求助（面向陌生志愿者）：
const helpRequestSchema = z.object({
  callId: z.string().min(1).max(128),
  language: z.string().max(8).optional(),
  locality: z.string().max(80).optional(),
  topic: z.string().max(200).optional(),
})
const helpClaimSchema = z.object({ callId: z.string().min(1).max(128) })
const helpMatchSchema = z.object({
  preferredLanguage: z.string().max(8).optional(),
  requireLanguageMatch: z.boolean().optional(),
})

export function registerAssistRoutes(
  app: FastifyInstance,
  store: Store,
  hub: SignalingHub,
  presence: PresenceRegistry,
  pendingCalls: PendingCallRegistry,
  openHelp: OpenHelpRegistry,
  pushSender: PushSender,
  metrics: Metrics,
): void {
  // 协助者/亲友"在线待命"心跳（客户端定期调用；available=false 即下线）。
  app.post('/api/assist/heartbeat', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = heartbeatSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    presence.heartbeat(req.user!.sub, parsed.data.available, Date.now(), parsed.data.at ?? Date.now())
    return { ok: true }
  })

  // 协助者行为守则确认（Aira 范式："只描述所见，安全决策由对方做出"）：客户端在用户首次
  // 接单/接听前展示一次性守则卡，确认后调本端点留痕（selfView 回传 helperGuidelineAckAt，
  // null 即客户端该展示）。keep-first 幂等：重复确认不刷新时间戳——首次确认时刻才是追责锚点。
  app.post('/api/assist/guideline-ack', { preHandler: requireAuth() }, async (req, reply) => {
    const me = store.findById(req.user!.sub)
    if (!me) return reply.code(404).send({ error: 'not_found' })
    const at = me.helperGuidelineAckAt ?? Date.now()
    if (!me.helperGuidelineAckAt) store.updateUser(me.id, { helperGuidelineAckAt: at })
    return { ok: true, helperGuidelineAckAt: at }
  })

  // WebRTC ICE 服务器（STUN + 短时效 TURN 凭据）。客户端通话前拉取。
  app.get('/api/assist/turn', { preHandler: requireAuth() }, async () => {
    const stun = (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean)
    const turn = (process.env.TURN_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const iceServers = buildIceServers({
      stun,
      turn,
      secret: process.env.TURN_SECRET,
      ttlSeconds: 6 * 60 * 60, // 6 小时
      nowMs: Date.now(),
    })
    return { iceServers }
  })

  // 视障侧请求匹配：在"我绑定的亲友/协助者"里挑在线可用者，按优先级排序。
  app.post('/api/assist/match', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = matchSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const now = Date.now()
    // 仅 accepted 的绑定参与匹配（见审查 #6）；并排除黑名单双方（见黑名单需求）。
    const blocked = blockedUserIdSet(store, req.user!.sub)
    const links = store.linksByOwner(req.user!.sub)
      .filter((l) => (l.status ?? 'accepted') === 'accepted' && !blocked.has(l.memberId))
    const candidates: Candidate[] = links.map((l) => ({
      userId: l.memberId,
      online: presence.isAvailable(l.memberId, now) || hub.isOnline(l.memberId),
      isEmergency: l.isEmergency,
      load: hub.callCount(l.memberId),
      language: store.findById(l.memberId)?.language, // 让 preferredLanguage 真正生效（见审查 #10）
    }))
    const ranked = rankHelpers(candidates, {
      emergency: parsed.data.emergency ?? false,
      preferredLanguage: parsed.data.preferredLanguage,
    })
    const targets = ranked.map((c) => {
      const u = store.findById(c.userId)
      return { memberId: c.userId, memberName: u?.displayName ?? '未知', avatar: u?.avatar ?? null, isEmergency: c.isEmergency, load: c.load }
    })
    return { targets, count: targets.length }
  })

  // 求助端：统计我绑定的协助者/亲友中有多少在线（供求助前显示"X 位在线"）。
  app.get('/api/assist/online-count', { preHandler: requireAuth() }, async (req) => {
    const now = Date.now()
    const blocked = blockedUserIdSet(store, req.user!.sub)
    const links = store.linksByOwner(req.user!.sub)
      .filter((l) => (l.status ?? 'accepted') === 'accepted' && !blocked.has(l.memberId))
    const online = links.filter((l) => presence.isAvailable(l.memberId, now) || hub.isOnline(l.memberId)).length
    return { total: links.length, online }
  })

  // 视障侧发起呼叫：登记 callId 与目标用户，供在线协助者/亲友轮询发现并加入（免推送前台会合）。
  app.post('/api/assist/call', { preHandler: [requireAuth(), requireFeature(store, 'calls')] }, async (req, reply) => {
    const parsed = callSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const from = req.user!
    // 仅允许呼叫与自己有**已接受**绑定、且未互相拉黑的目标（防越权/骚扰，见审查 #1/#6）。
    // acceptedContactIds 已是双向(owner∪member)并排除黑名单。
    const allowed = acceptedContactIds(store, from.sub)
    const targets = parsed.data.targetUserIds.filter((id) => allowed.has(id))
    if (targets.length === 0) return reply.code(403).send({ error: 'not_linked' })
    // 防单用户用大量 callId 灌满待接表、把他人(尤其盲人的紧急来电)挤出全局 cap。
    // 仅新 callId 受限；重发自己已有的 callId 放行。上限给足紧急重拨余量(10>正常的 1)。
    if (!pendingCalls.hasActive(parsed.data.callId, Date.now()) && pendingCalls.activeCountFor(from.sub, Date.now()) >= 10) {
      return reply.code(429).send({ error: 'too_many_requests' })
    }
    const ok = pendingCalls.register({
      callId: parsed.data.callId,
      fromUserId: from.sub,
      fromName: store.findById(from.sub)?.displayName ?? '求助者',
      toUserIds: targets,
      createdAt: Date.now(),
    })
    if (!ok) return reply.code(409).send({ error: 'call_id_conflict' }) // 该 callId 被他人占用，防覆盖/劫持(见审查 #2)
    // 通话记录：每个目标一条（默认 missed，被叫接听/拒绝后更新）。
    const recAt = Date.now()
    for (const id of targets) store.createCallRecord({ id: randomUUID(), callId: parsed.data.callId, callerId: from.sub, calleeId: id, status: 'missed', createdAt: recAt })
    // A1：向各目标设备推 VoIP 来电（后台/锁屏唤起 CallKit）。fire-and-forget，失败不阻断呼叫。
    const callerName = store.findById(from.sub)?.displayName ?? '求助者'
    console.log('[call] dispatch from=%s callId=%s targets=%j voip=%j apns=%j',
      from.sub, parsed.data.callId, targets,
      targets.map((id) => (store.findById(id)?.voipToken ? 1 : 0)),
      targets.map((id) => (store.findById(id)?.apnsToken ? 1 : 0)))
    for (const id of targets) {
      const u = store.findById(id)
      if (u?.voipToken) void pushSender.sendCallInvite(u.voipToken, parsed.data.callId, callerName, from.sub)
      // 兜底：同时发一条普通提醒推送（万一 CallKit 未弹，至少出现"来电"横幅，可点开 App 接听）。
      // 文案按收件人语言（users.language，pushStrings）——推送在 App 外展示，客户端文案表够不着。
      if (u?.apnsToken) {
        const lang = pushLang(u.language)
        void pushSender.sendAlert(u.apnsToken, pushStrings.incomingCallTitle(callerName, lang),
                                  pushStrings.incomingCallBody(lang),
                                  { kind: 'incoming_call', callId: parsed.data.callId })
          .catch(() => {})
      }
    }
    metrics.inc('calls_registered_total')
    return { ok: true }
  })

  // 协助者/亲友轮询：取针对自己的待接来电（callId + 发起人）。
  app.get('/api/assist/incoming', { preHandler: requireAuth() }, async (req) => {
    const calls = pendingCalls.incomingFor(req.user!.sub, Date.now())
    return { calls: calls.map((c) => ({ callId: c.callId, fromName: c.fromName, fromUserId: c.fromUserId, fromAvatar: store.findById(c.fromUserId)?.avatar ?? null })) }
  })

  // 取消/结束待接来电（接通或挂断后清理）。仅发起人或目标可取消（归属校验，防越权压制，见审查 #3）。
  app.post('/api/assist/call/cancel', { preHandler: requireAuth() }, async (req, reply) => {
    const id = (req.body as { callId?: string })?.callId
    if (typeof id !== 'string' || !id) return reply.code(400).send({ error: 'invalid_input' })
    pendingCalls.cancel(id, req.user!.sub)
    return { ok: true }
  })

  // 目标"拒绝"来电：保留登记，让发起方轮询看到"对方已拒绝"（区别于取消/超时）。
  app.post('/api/assist/call/decline', { preHandler: requireAuth() }, async (req, reply) => {
    const id = (req.body as { callId?: string })?.callId
    if (typeof id !== 'string' || !id) return reply.code(400).send({ error: 'invalid_input' })
    pendingCalls.decline(id, req.user!.sub, Date.now())
    store.updateCallStatus(id, req.user!.sub, 'declined') // 通话记录：标记为已拒绝
    return { ok: true }
  })

  // 被叫接听：**首接抢占**（群呼时第一位接听者生效），并把通话记录标记为已接听。
  // 返回 answeredBy：若是别人，客户端提示"已被其他亲友接听"而非加入失败；
  // 同时该呼叫从其余目标的 /incoming 消失（应用内振铃自动停）。
  app.post('/api/assist/call/answered', { preHandler: requireAuth() }, async (req, reply) => {
    const id = (req.body as { callId?: string })?.callId
    if (typeof id !== 'string' || !id) return reply.code(400).send({ error: 'invalid_input' })
    const winner = pendingCalls.claimAnswer(id, req.user!.sub, Date.now())
    const youWon = winner === req.user!.sub || winner === null
    if (youWon) {
      // null=非群呼登记内(如公开求助认领路径)：沿用原行为只记通话记录。
      store.updateCallStatus(id, req.user!.sub, 'answered')
    }
    return { ok: true, answeredBy: winner ?? req.user!.sub, youWon }
  })

  // 通话记录（呼出/呼入/未接）：我作为主叫或被叫的记录，按时间倒序。
  app.get('/api/calls', { preHandler: requireAuth() }, async (req) => {
    const me = req.user!.sub
    const recs = store.callRecordsForUser(me, 100)
    return {
      calls: recs.map((r) => {
        const outgoing = r.callerId === me
        const other = store.findById(outgoing ? r.calleeId : r.callerId)
        return {
          id: r.id,
          callId: r.callId,
          direction: outgoing ? 'outgoing' : 'incoming',
          status: r.status, // missed/answered/declined
          peerName: other?.displayName ?? '已注销用户',
          peerAvatar: other?.avatar ?? null,
          createdAt: r.createdAt,
        }
      }),
    }
  })

  // 发起方轮询呼叫状态：是否所有目标已拒绝（据此在通话界面显示"对方已拒绝"）。
  app.get('/api/assist/call/status', { preHandler: requireAuth() }, async (req) => {
    const id = (req.query as { callId?: string })?.callId
    if (typeof id !== 'string' || !id) return { exists: false, declinedAll: false }
    // 死锁自愈：呼叫方（盲人）本就在轮询本端点等接通——借此驱动"已认领却接不通"的重开。若首接者超过
    // 20s 仍未进 ws 房间（App 被杀/建连失败），清 answeredBy 让呼叫重新对其余亲友振铃，而非死锁到 TTL。
    pendingCalls.reopenStaleAnswer(id, Date.now(), 20_000, (uid) => hub.peersInCall(id).some((p) => p.userId === uid))
    return pendingCalls.status(id, Date.now())
  })

  // MARK: 公开求助队列（面向陌生志愿者的众包协助，区别于上面定向呼叫亲友）

  // 视障侧广播一条公开求助：登记 callId + 粗粒度信息，供在线志愿者浏览/匹配并加入 callId 房间。
  // language 缺省取账号语言。重复广播（同一发起人同一 callId）幂等更新。
  app.post('/api/assist/help/request', { preHandler: [requireAuth(), requireFeature(store, 'helpRequests')] }, async (req, reply) => {
    const parsed = helpRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    // 内容审核：topic/locality 会广播给队列里所有在线志愿者（可见面最广的用户文本），与消息/群名/昵称同口径过滤。
    // 正常端是预设选项，此处防改造客户端把违禁词广播给众人。
    const cfg = store.getAppConfig()
    if (matchBannedTerm(cfg, parsed.data.topic ?? '') || matchBannedTerm(cfg, parsed.data.locality ?? '')) {
      return reply.code(403).send({ error: 'content_blocked' })
    }
    // 防单用户用大量 callId 灌满公开队列、把久等盲人的求助挤出全局 cap：限每用户活跃求助数。
    // 仅新 callId 受限；重发自己已有的 callId（更新等待信息）放行。正常用户同时只有 1 条。
    if (!openHelp.byId(parsed.data.callId) && openHelp.activeCountFor(req.user!.sub, Date.now()) >= 5) {
      return reply.code(429).send({ error: 'too_many_requests' })
    }
    const me = store.findById(req.user!.sub)
    const ok = openHelp.register({
      callId: parsed.data.callId,
      fromUserId: req.user!.sub,
      fromName: me?.displayName ?? '求助者',
      fromAvatar: me?.avatar,
      language: parsed.data.language ?? me?.language,
      locality: parsed.data.locality,
      topic: parsed.data.topic,
      createdAt: Date.now(),
    })
    if (!ok) return reply.code(409).send({ error: 'call_id_conflict' }) // callId 被他人占用，防覆盖/劫持
    metrics.inc('help_requests_total')
    // 注意：公开求助**不发对外推送**——只有打开 App 的用户经队列轮询看到（按需求“有人发起求助不用通知”）。
    return { ok: true }
  })

  // 志愿者浏览公开求助队列（粗粒度摘要，排除自己发起的与黑名单双方；不含精确坐标/联系方式）。
  app.get('/api/assist/help/queue', { preHandler: requireAuth() }, async (req) => {
    const list = openHelp.summaries(Date.now(), req.user!.sub, blockedUserIdSet(store, req.user!.sub))
    return { requests: list, count: list.length }
  })

  // 志愿者认领指定求助：原子操作，一条求助只能被一位志愿者拿到。成功后双方可加入 callId 房间。
  app.post('/api/assist/help/claim', { preHandler: [requireAuth(), requireFeature(store, 'helpRequests')] }, async (req, reply) => {
    const parsed = helpClaimSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    // 黑名单：不能认领与自己互拉黑者的求助。
    const existing = openHelp.byId(parsed.data.callId)
    if (existing && isBlockedBetween(store, req.user!.sub, existing.fromUserId)) {
      return reply.code(403).send({ error: 'blocked' })
    }
    const claimed = openHelp.claim(parsed.data.callId, req.user!.sub, Date.now())
    if (!claimed) return reply.code(409).send({ error: 'already_claimed_or_gone' })
    metrics.inc('help_claims_total')
    return { request: detailView(claimed) }
  })

  // 志愿者随机/偏好匹配一条公开求助并直接认领。无可匹配则 request 为 null（非错误）。
  app.post('/api/assist/help/match', { preHandler: [requireAuth(), requireFeature(store, 'helpRequests')] }, async (req, reply) => {
    const parsed = helpMatchSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const matched = openHelp.matchOne(
      { preferredLanguage: parsed.data.preferredLanguage, requireLanguageMatch: parsed.data.requireLanguageMatch },
      req.user!.sub,
      Date.now(),
      blockedUserIdSet(store, req.user!.sub), // 排除黑名单双方
    )
    return { request: matched ? detailView(matched) : null }
  })

  // 取消公开求助（发起人撤销）/ 放弃认领（志愿者释放回队列）。归属校验防越权。
  app.post('/api/assist/help/cancel', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = helpClaimSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    openHelp.cancel(parsed.data.callId, req.user!.sub, Date.now())
    return { ok: true }
  })
}

/// 认领成功后返回给志愿者的详情（含求助者显示名/语言/地点/内容，供其决定是否帮助 + 入会）。
function detailView(r: { callId: string; fromName: string; fromAvatar?: string; language?: string; locality?: string; topic?: string }) {
  return { callId: r.callId, fromName: r.fromName, fromAvatar: r.fromAvatar ?? null, language: r.language ?? null, locality: r.locality ?? null, topic: r.topic ?? null }
}
