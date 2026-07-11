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
  // 用户是否有"可用的紧急联系人"（我拥有、已接受、标为紧急）——dead-man's switch 到期只对这类扇出
  // （见 checkin.ts fireExpiredSafetyTimers）。一个都没有=到点没报平安也无人会被通知（假安心），客户端据此持续预警。
  const hasEmergencyContact = (userId: string): boolean =>
    store.linksByOwner(userId).some((l) => (l.status ?? 'accepted') === 'accepted' && l.isEmergency)
  // 到期告警**实际发给全体 accepted 联系人**（fireExpiredSafetyTimers，isEmergency 仅额外授医疗信息）——故
  // "到点没报平安会不会有人被通知"须以全体 accepted 为准。只看 isEmergency 会在"有联系人却没标紧急"时误报
  // "无人会被通知"（与应急就绪同源的真警报，见 emergency readiness 修复）。
  const hasAnyContact = (userId: string): boolean =>
    store.linksByOwner(userId).some((l) => (l.status ?? 'accepted') === 'accepted')

  // 当前进行中的报到（客户端展示剩余时间；无则 null）+ 是否有紧急联系人（供进行中持续预警"到点无人可通知"）。
  app.get('/api/safety/checkin', { preHandler: requireAuth() }, async (req) => {
    const me = req.user!.sub
    const t = store.activeSafetyTimerForOwner(me)
    return { timer: t ? view(t, Date.now()) : null, hasEmergencyContact: hasEmergencyContact(me), hasAnyContact: hasAnyContact(me) }
  })

  // 每日定时安全报到（Snug Safety 式）：每天固定本地时刻自动开启一次报到，超时未报平安自动告警紧急联系人。
  // 配置存 User.dailyCheckin（偏好数据，随删号级联/进导出）；实际开启由后台 startDueDailyCheckins 每分钟扫。
  const scheduleSchema = z.object({
    enabled: z.boolean(),
    startMinute: z.number().int().min(0).max(1439),
    durationMinutes: z.number().int().min(MIN_MINUTES).max(MAX_MINUTES),
    tz: z.string().trim().min(1).max(64),
    note: z.string().trim().max(200).optional(),
    // 暂停至（ms）：住院/出行临时停用、到点自动恢复。0/缺省=不暂停（恢复）。上限见 handler（须未来、且≤1 年防误设"永久暂停"）。
    pausedUntil: z.number().int().nonnegative().optional(),
  })
  const MAX_PAUSE_MS = 366 * 24 * 60 * 60 * 1000 // ~1 年上限：防 fat-finger 设成"永久暂停"而静默长期失去安全网
  app.get('/api/safety/checkin/schedule', { preHandler: requireAuth() }, async (req) => {
    const u = store.findById(req.user!.sub)
    return { schedule: u?.dailyCheckin ?? null }
  })

  // 报到历史（本人回看）：近 30 条自己的报到记录（startedAt 倒序）——含**已告警(fired)**的那几次
  // （错过报到、告警已发给亲友），供本人复盘/安心。仅暴露展示字段，endedAt 归一为 完成/取消/告警 时刻。
  app.get('/api/safety/checkin/history', { preHandler: requireAuth() }, async (req) => {
    const timers = store.safetyTimersForUser(req.user!.sub).slice(0, 30)
    return {
      history: timers.map((tm) => ({
        id: tm.id,
        status: tm.status, // active/completed/canceled/fired/expired
        startedAt: tm.startedAt,
        dueAt: tm.dueAt,
        note: tm.note ?? null,
        endedAt: tm.completedAt ?? tm.canceledAt ?? tm.firedAt ?? null,
      })),
    }
  })
  app.put('/api/safety/checkin/schedule', { preHandler: requireAuth(),
                                            config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = scheduleSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    // tz 必须是 Intl 认识的 IANA 时区——坏 tz 会让后台扫描静默跳过（fail-open），等于"开了却永不开启"的假安心，
    // 收下前就拒掉。校验用真实 Intl 探测（与运行时同一判定，绝不自造时区表）。
    try { new Intl.DateTimeFormat('en-US', { timeZone: parsed.data.tz }) } catch { return reply.code(400).send({ error: 'invalid_timezone' }) }
    const note = parsed.data.note
    // 备注会念给亲友（到期告警正文）——与手动 start 同口径过违禁词。
    if (note) { const cfg = store.getAppConfig(); if (matchBannedTerm(cfg, note)) return reply.code(403).send({ error: 'content_blocked' }) }
    // 暂停至：仅接受**未来且 ≤1 年**的时刻；过去/超限一律视作"未暂停"（不存陈旧/离谱的暂停态，防静默长期失去安全网）。
    const now = Date.now()
    const pausedUntil = parsed.data.pausedUntil && parsed.data.pausedUntil > now && parsed.data.pausedUntil <= now + MAX_PAUSE_MS
      ? parsed.data.pausedUntil : undefined
    // 重置 lastDay：改配置（尤其把时刻改到今天晚些时候）后当天即按新配置生效，不被旧标记挡住。
    const updated = store.updateUser(req.user!.sub, {
      dailyCheckin: { enabled: parsed.data.enabled, startMinute: parsed.data.startMinute, durationMinutes: parsed.data.durationMinutes, tz: parsed.data.tz, note, pausedUntil },
      dailyCheckinLastDay: undefined,
    })
    if (!updated) return reply.code(404).send({ error: 'not_found' })
    return { ok: true, schedule: updated.dailyCheckin, hasEmergencyContact: hasEmergencyContact(req.user!.sub), hasAnyContact: hasAnyContact(req.user!.sub) }
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
    // 无紧急联系人预警（防假安心）：一个都没有则到期告警**无人可通知**、报到形同虚设。不阻断开始
    // （用户可能正要去加联系人），但据此让客户端提示"先设紧急联系人"。判定与 GET/fire 路径共用同一 helper。
    return { timer: view(timer, now), hasEmergencyContact: hasEmergencyContact(me), hasAnyContact: hasAnyContact(me) }
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
