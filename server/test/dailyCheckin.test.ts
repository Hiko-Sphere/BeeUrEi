import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { NoopPushSender } from '../src/push/apns'
import { NoopWebPushSender } from '../src/push/webPush'
import { startDueDailyCheckins } from '../src/safety/checkin'

// 每日定时安全报到（Snug Safety 式）：到点自动开启 dead-man's switch，超时未报平安走既有告警链。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const push = new NoopPushSender()
const webPush = new NoopWebPushSender()

describe('每日定时报到 配置端点 /api/safety/checkin/schedule', () => {
  async function seed() {
    const store = new MemoryStore()
    const app = buildApp(store)
    const me = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'dcuser', password: 'secret123', role: 'blind' } })).json()
    return { app, store, me, h: auth(me.token) }
  }

  it('初始 null；PUT 保存 → GET 返回；坏时区 400 invalid_timezone；越界分钟 400', async () => {
    const { app, h } = await seed()
    expect(((await app.inject({ method: 'GET', url: '/api/safety/checkin/schedule', headers: h })).json() as any).schedule).toBeNull()
    const ok = await app.inject({ method: 'PUT', url: '/api/safety/checkin/schedule', headers: h,
      payload: { enabled: true, startMinute: 540, durationMinutes: 30, tz: 'Asia/Shanghai', note: '独居晨间报到' } })
    expect(ok.statusCode).toBe(200)
    expect((ok.json() as any).schedule).toMatchObject({ enabled: true, startMinute: 540, durationMinutes: 30, tz: 'Asia/Shanghai' })
    expect((await app.inject({ method: 'GET', url: '/api/safety/checkin/schedule', headers: h })).json()).toMatchObject({ schedule: { startMinute: 540 } })
    // 坏时区：收下会让后台扫描静默跳过=“开了却永不开启”的假安心 → 收下前就拒。
    expect((await app.inject({ method: 'PUT', url: '/api/safety/checkin/schedule', headers: h,
      payload: { enabled: true, startMinute: 540, durationMinutes: 30, tz: 'Mars/Olympus' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/safety/checkin/schedule', headers: h,
      payload: { enabled: true, startMinute: 1440, durationMinutes: 30, tz: 'UTC' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/safety/checkin/schedule', headers: h,
      payload: { enabled: true, startMinute: 540, durationMinutes: 3, tz: 'UTC' } })).statusCode).toBe(400) // <5min
    await app.close()
  })

  it('违禁词备注 403；保存重置 lastDay（改到今天晚些时候也当天生效）', async () => {
    const { app, store, me, h } = await seed()
    store.setAppConfig({ contentFilter: { enabled: true, terms: ['敏感词'] } })
    expect((await app.inject({ method: 'PUT', url: '/api/safety/checkin/schedule', headers: h,
      payload: { enabled: true, startMinute: 540, durationMinutes: 30, tz: 'UTC', note: '含敏感词' } })).statusCode).toBe(403)
    // 先落一个 lastDay，再保存配置 → 被重置。
    store.updateUser(me.user.id, { dailyCheckinLastDay: '2026-01-05' })
    expect((await app.inject({ method: 'PUT', url: '/api/safety/checkin/schedule', headers: h,
      payload: { enabled: true, startMinute: 600, durationMinutes: 30, tz: 'UTC' } })).statusCode).toBe(200)
    expect(store.findById(me.user.id)?.dailyCheckinLastDay).toBeUndefined()
    await app.close()
  })
})

describe('每日定时报到 后台扫描 startDueDailyCheckins', () => {
  const mk = (over: Record<string, unknown> = {}) => {
    const store = new MemoryStore()
    store.createUser({ id: 'u1', username: 'daily1', passwordHash: 'h', displayName: '独居者', role: 'blind', status: 'active', createdAt: 1,
      dailyCheckin: { enabled: true, startMinute: 540, durationMinutes: 30, tz: 'UTC' }, ...over } as never)
    return store
  }
  const at = (h: number, m: number) => Date.UTC(2026, 0, 5, h, m) // 2026-01-05 UTC

  it('窗口内 → 自动开启一次：建 active 计时器(dueAt=+30min)、落 lastDay、通知本人；同日再扫不重复', () => {
    const store = mk()
    const now = at(9, 0) // startMinute 540 = 09:00 UTC
    expect(startDueDailyCheckins(store, push, webPush, now)).toBe(1)
    const t = store.activeSafetyTimerForOwner('u1')!
    expect(t.status).toBe('active')
    expect(t.dueAt).toBe(now + 30 * 60_000)
    expect(store.findById('u1')?.dailyCheckinLastDay).toBe('2026-01-05')
    expect(store.notificationsForUser('u1').some((n) => n.kind === 'safety_checkin_started')).toBe(true)
    // 同日幂等：即便用户随后报平安（timer 终态），当天也不再自动开第二次。
    store.updateSafetyTimer(t.id, { status: 'completed', completedAt: now + 1000 })
    expect(startDueDailyCheckins(store, push, webPush, at(9, 30))).toBe(0)
    // 次日同一时刻 → 再次开启。
    expect(startDueDailyCheckins(store, push, webPush, Date.UTC(2026, 0, 6, 9, 0))).toBe(1)
  })

  it('窗口外不开启：到点前不开；超宽限(默认60min)不迟开（宕机恢复诚实跳过当天）', () => {
    expect(startDueDailyCheckins(mk(), push, webPush, at(8, 59))).toBe(0)  // 早于 09:00
    expect(startDueDailyCheckins(mk(), push, webPush, at(10, 0))).toBe(0)  // 09:00+60min 之后
    expect(startDueDailyCheckins(mk(), push, webPush, at(9, 59))).toBe(1)  // 宽限窗内仍开
  })

  it('已有进行中的手动报到 → 不叠开，但标记当天已处理（不会晚些时候又自动开）', () => {
    const store = mk()
    store.createSafetyTimer({ id: 'manual', ownerId: 'u1', startedAt: at(8, 0), dueAt: at(11, 0), status: 'active' })
    expect(startDueDailyCheckins(store, push, webPush, at(9, 0))).toBe(0)
    expect(store.activeSafetyTimerForOwner('u1')?.id).toBe('manual') // 手动的没被顶掉
    expect(store.findById('u1')?.dailyCheckinLastDay).toBe('2026-01-05') // 当天已处理
  })

  it('disabled/坏时区/封禁用户 → 一律不开启', () => {
    expect(startDueDailyCheckins(mk({ dailyCheckin: { enabled: false, startMinute: 540, durationMinutes: 30, tz: 'UTC' } }), push, webPush, at(9, 0))).toBe(0)
    expect(startDueDailyCheckins(mk({ dailyCheckin: { enabled: true, startMinute: 540, durationMinutes: 30, tz: 'Mars/Olympus' } }), push, webPush, at(9, 0))).toBe(0)
    expect(startDueDailyCheckins(mk({ status: 'disabled' }), push, webPush, at(9, 0))).toBe(0)
  })

  it('SqliteStore 列往返：dailyCheckin JSON + lastDay 存取一致；updateUser 重置 lastDay 生效', () => {
    const s = new SqliteStore(':memory:')
    s.createUser({ id: 'u1', username: 'dcsq', passwordHash: 'h', displayName: 'x', role: 'blind', status: 'active', createdAt: 1,
      dailyCheckin: { enabled: true, startMinute: 540, durationMinutes: 30, tz: 'Asia/Shanghai', note: '晨间' }, dailyCheckinLastDay: '2026-01-05' })
    expect(s.findById('u1')?.dailyCheckin).toMatchObject({ startMinute: 540, tz: 'Asia/Shanghai', note: '晨间' })
    expect(s.findById('u1')?.dailyCheckinLastDay).toBe('2026-01-05')
    s.updateUser('u1', { dailyCheckinLastDay: undefined })
    expect(s.findById('u1')?.dailyCheckinLastDay).toBeUndefined()
  })
})
