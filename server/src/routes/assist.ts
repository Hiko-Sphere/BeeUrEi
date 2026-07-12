import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, isBlockedBetween, blockedUserIdSet, matchBannedTerm, acceptedContactIds } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { signWsToken } from '../auth/tokens'
import { SignalingHub } from '../signaling/hub'
import { PresenceRegistry } from '../assist/presence'
import { rankHelpers, type Candidate } from '../assist/matcher'
import { buildIceServers } from '../assist/turnCredentials'
import { PendingCallRegistry } from '../assist/pendingCalls'
import { pushLang, pushStrings } from '../push/pushStrings'
import { OpenHelpRegistry } from '../assist/openHelp'
import { type PushSender } from '../push/apns'
import { NoopWebPushSender, type WebPushSender } from '../push/webPush'
import { type Metrics } from '../metrics/metrics'

// ⚠️ 求助/待命是仅次于 SOS 的生命线：schema 的 **optional 附注字段一律 .catch(undefined)**（坏值丢字段、
// 请求照常），核心字段（available/callId/targetUserIds）保持严格——与 emergency.ts 同一范式（R71/R72）。
// at：客户端时钟戳，处理器本就有 ?? Date.now() 兜底——坏值 400 会把待命心跳打断、协助者凭空显示离线。
const heartbeatSchema = z.object({ available: z.boolean(), at: z.number().optional().catch(undefined) })
// emergency/preferredLanguage 是匹配偏好：坏值退化为默认匹配，远好过"一键求助"在匹配一步就 400。
const matchSchema = z.object({ emergency: z.boolean().optional().catch(undefined), preferredLanguage: z.string().max(16).optional().catch(undefined) })
// emergency：本次呼叫是否为**紧急求助**（盲人一键 SOS 呼叫亲友，区别于日常"帮我看一下"）——供被叫端
// 突出显示/更急促响铃、优先应答。坏值退化为 false（绝不让"一键求助"因该可选标志 400，与 match 同范式）。
const callSchema = z.object({ callId: z.string().min(1).max(128), targetUserIds: z.array(z.string().min(1)).min(1).max(20), emergency: z.boolean().optional().catch(undefined) })
// 公开求助（面向陌生志愿者）：language/locality/topic 只是路由/展示提示——locality 来自反向地理编码，
// 编码器给出超长地名时绝不能 400 掉整个求助（盲人听到"求助失败"且重试还是同一地名，死路）。
const helpRequestSchema = z.object({
  callId: z.string().min(1).max(128),
  language: z.string().max(8).optional().catch(undefined),
  locality: z.string().max(80).optional().catch(undefined),
  topic: z.string().max(200).optional().catch(undefined),
})
const helpClaimSchema = z.object({ callId: z.string().min(1).max(128) })
// 通话连接失败上报（客户端 ICE 失败诊断 → 服务端可观测）：reason 是**白名单枚举**——绝不能拿客户端
// 任意串拼进 metric 名（否则可注入/无界撑爆 counters map）。callId 仅用于日志关联、不入库。
const callFailureSchema = z.object({
  reason: z.enum(['relay_unreachable', 'generic', 'signaling']),
  callId: z.string().min(1).max(128).optional().catch(undefined),
})
const helpMatchSchema = z.object({
  preferredLanguage: z.string().max(8).optional().catch(undefined),
  requireLanguageMatch: z.boolean().optional().catch(undefined),
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
  webPush: WebPushSender = new NoopWebPushSender(),
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
  app.get('/api/assist/turn', { preHandler: requireAuth() }, async (req) => {
    const stun = (process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean)
    const turn = (process.env.TURN_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const iceServers = buildIceServers({
      stun,
      turn,
      secret: process.env.TURN_SECRET,
      ttlSeconds: 6 * 60 * 60, // 6 小时
      nowMs: Date.now(),
    })
    // 一并下发短时**信令握手令牌**：网页端拿它进 WS URL 查询串（而非 1h 全权 access token），泄漏进日志也无害。
    // 与本次通话建连同一次请求取得（客户端建 WS 前本就 fetch 此端点），无额外往返；iOS 不用它、继续走 access token。
    const u = req.user!
    const wsToken = signWsToken({ sub: u.sub, role: u.role, tv: u.tv ?? 0, sid: u.sid })
    return { iceServers, wsToken }
  })

  // 通话连接失败上报（把 ICE relay 不可达等**静默 degrade** 变成运维可见的计数）。客户端在 ICE failed /
  // 信令断开时 best-effort 调本端点；服务端据白名单 reason 自增 metric（/metrics 可抓）+ warn 日志。
  // reason 白名单 → metric 名固定安全；rate-limit 防单端刷爆计数。best-effort：坏输入 400 但不影响通话。
  app.post('/api/assist/call-failure', { preHandler: requireAuth(),
                                        config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = callFailureSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const { reason, callId } = parsed.data
    metrics.inc(`call_ice_failure_${reason}_total`)
    // relay_unreachable 尤其指向 TURN 不可达（如安全组未放行 3478）——warn 级，运维一眼看见这道生命线故障。
    if (reason === 'relay_unreachable') {
      console.warn(`[assist] 通话中继不可达上报（TURN/安全组？）callId=${callId ?? '-'}`)
    }
    return { ok: true }
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
  // 端级限流 30/min：每次呼叫都向各目标扇出 VoIP+APNs+Web 三路来电推送（同 emergency/alert 的扇出兄弟，
  // 后者已 6/min）。此前仅有并发上限(activeCountFor≥10)——只挡"同时"、挡不住 register→cancel→register 的
  // 快速轮替刷推送（受害者按全局 300/min 仍可被 ~150 次/min 来电轰炸）。30/min 把每受害者上限压到 1/10：
  // 一次呼叫可一并 targetUserIds 至多 20 人（群呼是单请求非多请求），加急重拨也远达不到 30 次/min（≈每 2s 一次
  // 不合任何真人呼叫节奏），故绝不误伤真实 SOS 重拨；恶意骚扰则被硬顶。与消息发送 60/min 同为写扇出端级限流。
  app.post('/api/assist/call', { preHandler: [requireAuth(), requireFeature(store, 'calls')],
                                 config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
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
      emergency: parsed.data.emergency ?? false, // 紧急求助 → 被叫端突出显示/优先应答
    })
    if (!ok) return reply.code(409).send({ error: 'call_id_conflict' }) // 该 callId 被他人占用，防覆盖/劫持(见审查 #2)
    // 通话记录：每个目标一条（默认 missed，被叫接听/拒绝后更新）。
    const recAt = Date.now()
    for (const id of targets) store.createCallRecord({ id: randomUUID(), callId: parsed.data.callId, callerId: from.sub, calleeId: id, status: 'missed', createdAt: recAt, emergency: parsed.data.emergency ?? false })
    // A1：向各目标设备推 VoIP 来电（后台/锁屏唤起 CallKit）。fire-and-forget，失败不阻断呼叫。
    const callerName = store.findById(from.sub)?.displayName ?? '求助者'
    console.log('[call] dispatch from=%s callId=%s targets=%j voip=%j apns=%j',
      from.sub, parsed.data.callId, targets,
      targets.map((id) => (store.findById(id)?.voipToken ? 1 : 0)),
      targets.map((id) => (store.findById(id)?.apnsToken ? 1 : 0)))
    for (const id of targets) {
      // 单个目标的**同步** store 读（findById/web 订阅）抛错（SQLITE_BUSY 等）绝不能掐断对其余目标的来电投递
      // ——盲人求助时希望触达尽可能多的协助者（见 SOS 扇出复审同类）。
      try {
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
        // Web Push：web-only 协助者关掉标签页也能收到来电系统通知——点开落回 /app，呼叫仍在
        // 登记 TTL 内的话 IncomingCallHost 轮询即弹铃。与 APNs 各自 best-effort，失败不阻断呼叫。
        if (webPush.configured && u) {
          const lang = pushLang(u.language)
          const payload = JSON.stringify({ title: pushStrings.incomingCallTitle(callerName, lang),
            body: pushStrings.incomingCallBody(lang), data: { kind: 'incoming_call', callId: parsed.data.callId, fromId: from.sub } })
          for (const sub of store.webPushSubscriptionsForUser(id)) void webPush.send(sub, payload).catch(() => {})
        }
      } catch { /* 单目标推送准备失败不阻断对其余目标的来电投递 */ }
    }
    metrics.inc('calls_registered_total')
    return { ok: true }
  })

  // 协助者/亲友轮询：取针对自己的待接来电（callId + 发起人）。
  app.get('/api/assist/incoming', { preHandler: requireAuth() }, async (req) => {
    const calls = pendingCalls.incomingFor(req.user!.sub, Date.now())
    return { calls: calls.map((c) => ({ callId: c.callId, fromName: c.fromName, fromUserId: c.fromUserId, fromAvatar: store.findById(c.fromUserId)?.avatar ?? null, emergency: c.emergency ?? false })) }
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
    // 只有**真正抢到首接**才算 youWon。winner===null 意味着呼叫已过期/不存在（/call/answered 仅用于定向
    // 呼叫；公开求助走独立的 /help/claim）——绝不能当 youWon=true，否则接听者以为接通了、随后 ws join 因
    // roomParticipants=null 被 not_a_participant 静默拒，"已接听却怎么都连不上"（见可靠性复审 MED）。
    const youWon = winner === req.user!.sub
    if (youWon) store.updateCallStatus(id, req.user!.sub, 'answered')
    return { ok: true, answeredBy: winner, youWon, gone: winner === null }
  })

  // 通话时长上报（挂断时客户端上报连接时长）：通话记录显示"3:24"。客户端知连接到挂断的时长，服务端信令有多个
  // 结束出口、不便可靠计时，故由参与方上报（低风险：仅影响本人参与的通话记录的展示时长）。60/min 限流。
  app.post('/api/assist/call/duration', { preHandler: requireAuth(),
                                          config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = z.object({ callId: z.string().min(1).max(128), seconds: z.number().int().min(0).max(86_400) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const me = req.user!.sub
    // 授权：上报者须是该 callId 的参与方（主叫或被叫）——否则不能给他人通话记录塞时长。
    // 全量判定 isCallParticipant，绝非 callRecordsForUser().some(...)——后者是"最近 100 条"窗口，
    // 活跃用户对稍旧通话的迟到上报（离线重试等）会被误拒（假否定）。
    if (!store.isCallParticipant(me, parsed.data.callId)) return reply.code(403).send({ error: 'not_participant' })
    store.setCallDuration(parsed.data.callId, me, parsed.data.seconds)
    return { ok: true }
  })

  // 通话记录（呼出/呼入/未接）：我作为主叫或被叫的记录，按时间倒序。
  // ?peek=1：**只读预览**（首页仪表盘"最近通话"用）——不刷新 callHistorySeenAt 基线。否则瞟一眼首页就把
  // 未接来电角标清零（角标本是"去看看"的提示，扫过仪表盘≠看过通话记录；且首页并行拉 unreadSummary 会与
  // 这里的基线刷新竞态，"未接来电"卡时而 N 时而 0）。真正打开通话记录页仍走默认路径清角标。
  app.get('/api/calls', { preHandler: requireAuth() }, async (req) => {
    const me = req.user!.sub
    const q = req.query as { peek?: string; before?: string; beforeId?: string; limit?: string }
    const peek = q.peek === '1'
    // 向前翻页游标（"加载更多"更早的通话）：before=毫秒时间戳、beforeId=同刻 tie-break。翻页请求本身即只读，
    // **不**刷新 callHistorySeenAt（翻看历史 ≠ 又"看过一次当前"，否则会与未接角标竞态）——等同 peek。
    const beforeMs = q.before != null && /^\d+$/.test(q.before) ? Number(q.before) : undefined
    const beforeId = typeof q.beforeId === 'string' && q.beforeId ? q.beforeId : undefined
    const isPage = beforeMs != null
    const limNum = q.limit != null && /^\d+$/.test(q.limit) ? Number(q.limit) : 100 // 默认 100：保持既有 iOS 无参调用的首屏条数不变
    const limit = Math.max(1, Math.min(100, limNum)) // clamp [1,100]：与 chat 分页同口径，防超大页拖库
    const recs = store.callRecordsForUser(me, limit + 1, beforeMs, beforeId) // 多取一条判 hasMore
    const hasMore = recs.length > limit
    const page = hasMore ? recs.slice(0, limit) : recs
    // 打开通话记录即"看过"：刷新基线，未看未接来电角标随之清零（与手机通话 App 一致）。仅**首屏**（非 peek、非翻页）刷新。
    // 在读取 recs 之后再刷新——返回列表仍照常带 missed 状态（供客户端把未接来电标红），只是角标不再计它们。
    if (!peek && !isPage) store.updateUser(me, { callHistorySeenAt: Date.now() })
    return {
      hasMore, // 是否还有更早的通话可翻页（web/iOS 据此显示"加载更多"）
      calls: page.map((r) => {
        const outgoing = r.callerId === me
        const other = store.findById(outgoing ? r.calleeId : r.callerId)
        return {
          id: r.id,
          callId: r.callId,
          direction: outgoing ? 'outgoing' : 'incoming',
          status: r.status, // missed/answered/declined
          peerId: other?.id ?? null, // 对端 id：前端据此让通话记录可点进聊天/回拨（已注销用户为 null，不可点）
          peerName: other?.displayName ?? '', // 已注销对端：留**空串**（语言中立），由客户端本地化「已注销用户/Deactivated user」——不在服务端硬编码中文（同 blocks/messages/conversations 口径）

          peerAvatar: other?.avatar ?? null,
          emergency: r.emergency ?? false, // 紧急求助呼叫：前端突出"未接紧急求助"，提示优先回拨
          durationSec: r.durationSec ?? null, // 通话时长（秒）：接通并有上报才有；供通话记录显示"3:24"
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
    // "认领却接不通"自愈：志愿者本就轮询本端点浏览队列——借此把认领者超 20s 未进 ws 房间的求助释放回
    // 队列（App 被杀/建连失败），让别的志愿者接手，而非卡在 claimed 直到 4 小时 TTL、盲人求助无人可接。
    openHelp.releaseStaleClaims(Date.now(), 20_000, (cid, uid) => hub.peersInCall(cid).some((p) => p.userId === uid))
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
