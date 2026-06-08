import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { SignalingHub } from '../signaling/hub'
import { PresenceRegistry } from '../assist/presence'
import { rankHelpers, type Candidate } from '../assist/matcher'
import { buildIceServers } from '../assist/turnCredentials'
import { PendingCallRegistry } from '../assist/pendingCalls'

const heartbeatSchema = z.object({ available: z.boolean(), at: z.number().optional() })
const matchSchema = z.object({ emergency: z.boolean().optional(), preferredLanguage: z.string().optional() })
const callSchema = z.object({ callId: z.string().min(1).max(128), targetUserIds: z.array(z.string().min(1)).min(1).max(20) })

export function registerAssistRoutes(
  app: FastifyInstance,
  store: Store,
  hub: SignalingHub,
  presence: PresenceRegistry,
  pendingCalls: PendingCallRegistry,
): void {
  // 协助者/亲友"在线待命"心跳（客户端定期调用；available=false 即下线）。
  app.post('/api/assist/heartbeat', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = heartbeatSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    presence.heartbeat(req.user!.sub, parsed.data.available, Date.now(), parsed.data.at ?? Date.now())
    return { ok: true }
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
    const links = store.linksByOwner(req.user!.sub)
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
      return { memberId: c.userId, memberName: u?.displayName ?? '未知', isEmergency: c.isEmergency, load: c.load }
    })
    return { targets, count: targets.length }
  })

  // 视障侧发起呼叫：登记 callId 与目标用户，供在线协助者/亲友轮询发现并加入（免推送前台会合）。
  app.post('/api/assist/call', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = callSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const from = req.user!
    // 仅允许呼叫与自己有亲友绑定关系的目标——否则任意用户可向任意 userId 强推伪造来电(越权/骚扰，见审查 #1)。
    const allowed = new Set(store.linksByOwner(from.sub).map((l) => l.memberId))
    const targets = parsed.data.targetUserIds.filter((id) => allowed.has(id))
    if (targets.length === 0) return reply.code(403).send({ error: 'not_linked' })
    const ok = pendingCalls.register({
      callId: parsed.data.callId,
      fromUserId: from.sub,
      fromName: store.findById(from.sub)?.displayName ?? '求助者',
      toUserIds: targets,
      createdAt: Date.now(),
    })
    if (!ok) return reply.code(409).send({ error: 'call_id_conflict' }) // 该 callId 被他人占用，防覆盖/劫持(见审查 #2)
    return { ok: true }
  })

  // 协助者/亲友轮询：取针对自己的待接来电（callId + 发起人）。
  app.get('/api/assist/incoming', { preHandler: requireAuth() }, async (req) => {
    const calls = pendingCalls.incomingFor(req.user!.sub, Date.now())
    return { calls: calls.map((c) => ({ callId: c.callId, fromName: c.fromName, fromUserId: c.fromUserId })) }
  })

  // 取消/结束待接来电（接通或挂断后清理）。仅发起人或目标可取消（归属校验，防越权压制，见审查 #3）。
  app.post('/api/assist/call/cancel', { preHandler: requireAuth() }, async (req, reply) => {
    const id = (req.body as { callId?: string })?.callId
    if (typeof id !== 'string' || !id) return reply.code(400).send({ error: 'invalid_input' })
    pendingCalls.cancel(id, req.user!.sub)
    return { ok: true }
  })
}
