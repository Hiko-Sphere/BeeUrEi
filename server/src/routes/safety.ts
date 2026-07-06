import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { requireAuth } from '../auth/rbac'
import { type Store, type SafetyTimer, matchBannedTerm } from '../db/store'
import { NoopPushSender, type PushSender } from '../push/apns'
import { NoopWebPushSender, type WebPushSender } from '../push/webPush'
import { broadcastAllClear } from '../emergency/allClear'

/// 安全报到（personal-safety "safety timer" / dead-man's switch）：盲人独自出行前设一个到期时刻，
/// 到期前未确认平安（complete）则后台自动告警其亲友（见 safety/checkin.fireExpiredSafetyTimers）。
/// 主动安全网，区别于摔倒检测/SOS 的被动告警。全部端点仅操作**本人**（req.user.sub）的报到，无跨用户面。

const MIN_MINUTES = 5
const MAX_MINUTES = 24 * 60           // 24h：覆盖一次出行；超过即非"出行"语义
const MAX_DUE_MS = MAX_MINUTES * 60_000

const startSchema = z.object({
  durationMinutes: z.number().int().min(MIN_MINUTES).max(MAX_MINUTES),
  note: z.string().trim().max(200).optional(),
})
const extendSchema = z.object({
  addMinutes: z.number().int().min(MIN_MINUTES).max(MAX_MINUTES),
})

function view(t: SafetyTimer, now: number) {
  return {
    id: t.id, note: t.note, status: t.status,
    startedAt: t.startedAt, dueAt: t.dueAt,
    remainingSec: Math.max(0, Math.round((t.dueAt - now) / 1000)),
  }
}

export function registerSafetyRoutes(app: FastifyInstance, store: Store,
                                     pushSender: PushSender = new NoopPushSender(),
                                     webPush: WebPushSender = new NoopWebPushSender()): void {
  // 当前进行中的报到（客户端展示剩余时间；无则 null）。
  app.get('/api/safety/checkin', { preHandler: requireAuth() }, async (req) => {
    const t = store.activeSafetyTimerForOwner(req.user!.sub)
    return { timer: t ? view(t, Date.now()) : null }
  })

  // 开始一次安全报到。同一人至多一个 active——重开即重置：取消旧的、起新的。
  app.post('/api/safety/checkin/start', { preHandler: requireAuth(),
                                          config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = startSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const me = req.user!.sub
    const note = parsed.data.note
    // 备注会念给亲友（到期告警正文）——与地点/消息同口径过违禁词。
    if (note) { const cfg = store.getAppConfig(); if (matchBannedTerm(cfg, note)) return reply.code(403).send({ error: 'content_blocked' }) }
    const now = Date.now()
    const existing = store.activeSafetyTimerForOwner(me)
    if (existing) store.updateSafetyTimer(existing.id, { status: 'canceled', canceledAt: now })
    const timer: SafetyTimer = {
      id: randomUUID(), ownerId: me, note,
      startedAt: now, dueAt: now + parsed.data.durationMinutes * 60_000, status: 'active',
    }
    store.createSafetyTimer(timer)
    // 无紧急联系人预警（防假安心）：dead-man's switch 到期只对"我拥有的、已接受且标为紧急"的联系人扇出
    // （与 checkin.ts fireExpiredSafetyTimers 同口径）——一个都没有则到期告警**无人可通知**，报到形同虚设。
    // 不阻断开始（用户可能正要去加联系人），但据此让客户端提示"先设紧急联系人，否则到点没人会被通知"。
    const hasEmergencyContact = store.linksByOwner(me).some((l) => (l.status ?? 'accepted') === 'accepted' && l.isEmergency)
    return { timer: view(timer, now), hasEmergencyContact }
  })

  // 报平安（我平安到了）：结束当前进行中的报到。
  // **关键**：一旦报到已 fired（到期告警已发出），本人自然会去按"我平安了"——此时必须等价于 all-clear：
  // 解除那条紧急事件 + 广播"我没事了"给亲友，否则告警石沉、亲友白担心、升级重呼还会再轰炸一次（对抗复审 CONFIRMED#1）。
  // 无 active、也无待解除的 fired → completed:false（幂等友好，语音端不报错）。
  app.post('/api/safety/checkin/complete', { preHandler: requireAuth(),
                                             config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const me = req.user!.sub
    const now = Date.now()
    const t = store.activeSafetyTimerForOwner(me)
    if (t) { store.updateSafetyTimer(t.id, { status: 'completed', completedAt: now }); return { ok: true, completed: true } }
    // 无 active：若刚有一条已 fired 的报到、其紧急事件仍未解除 → "我平安了"即等价 all-clear。
    const fired = store.safetyTimersForUser(me).find((x) => x.status === 'fired' && x.eventId)
    if (fired?.eventId) {
      const ev = store.emergencyEventsForUser(me).find((e) => e.id === fired.eventId)
      if (ev && ev.resolvedAt == null) {
        const res = broadcastAllClear(store, pushSender, webPush, me, now, { eventId: fired.eventId })
        return { ok: true, completed: true, clearedAlarm: res.resolved }
      }
    }
    return { ok: true, completed: false }
  })

  // 延长当前报到（多走一段路，避免误触发）。仅对 active 有效；从"现在或原到期时刻的较晚者"顺延，封顶 now+24h。
  app.post('/api/safety/checkin/extend', { preHandler: requireAuth(),
                                           config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = extendSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const t = store.activeSafetyTimerForOwner(req.user!.sub)
    if (!t) return reply.code(404).send({ error: 'no_active_timer' })
    const now = Date.now()
    // base 取 max(原到期, now)：即便已略过期未被 tick 触发，延长也总把到期推到未来（不会立刻被扫触发）。
    const base = Math.max(t.dueAt, now)
    const newDue = Math.min(base + parsed.data.addMinutes * 60_000, now + MAX_DUE_MS)
    // 清 remindedAt：延长后到期时刻推后，本人应对**新**到期重新获得一次提前提醒（否则延长后就再不提醒了）。
    store.updateSafetyTimer(t.id, { dueAt: newDue, remindedAt: undefined })
    return { timer: view({ ...t, dueAt: newDue }, now) }
  })

  // 取消当前报到（改主意/不出门了）。无进行中的 → canceled:false（幂等友好）。
  app.post('/api/safety/checkin/cancel', { preHandler: requireAuth(),
                                           config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const t = store.activeSafetyTimerForOwner(req.user!.sub)
    if (!t) return { ok: true, canceled: false }
    store.updateSafetyTimer(t.id, { status: 'canceled', canceledAt: Date.now() })
    return { ok: true, canceled: true }
  })
}
