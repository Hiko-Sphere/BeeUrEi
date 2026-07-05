import { describe, it, expect, afterEach } from 'vitest'
import { localMinuteOfDay, isQuietedNow, isAlwaysThrough, shouldSuppressPush } from '../src/notifications/quietHours'
import { notifyUser, setNotifyWebPush } from '../src/notifications/notify'
import { buildApp } from '../src/app'
import { MemoryStore, type QuietHours } from '../src/db/store'
import { type PushSender } from '../src/push/apns'
import { NoopWebPushSender, type WebPushSender } from '../src/push/webPush'
import { hashPassword } from '../src/auth/passwords'

// 2026-01-01 15:30:00 UTC —— 各时区本地分钟-of-day 已知，纯逻辑可确定性断言。
const E = Date.UTC(2026, 0, 1, 15, 30, 0)
const qh = (p: Partial<QuietHours>): QuietHours => ({ enabled: true, startMinute: 0, endMinute: 0, tz: 'UTC', ...p })

describe('quietHours 纯逻辑', () => {
  it('localMinuteOfDay：按时区正确换算，非法 tz → null', () => {
    expect(localMinuteOfDay(E, 'UTC')).toBe(15 * 60 + 30)              // 930
    expect(localMinuteOfDay(E, 'Asia/Shanghai')).toBe(23 * 60 + 30)   // 1410（UTC+8，无 DST）
    expect(localMinuteOfDay(E, 'America/New_York')).toBe(10 * 60 + 30) // 630（1 月 EST，UTC-5）
    expect(localMinuteOfDay(E, 'Not/AZone')).toBeNull()
    expect(localMinuteOfDay(E, '')).toBeNull()
    // 缺失/非串 tz 必须 null（Intl 对 undefined 不抛错而回退服务器时区——绝不能被当成有效换算）。
    expect(localMinuteOfDay(E, undefined as unknown as string)).toBeNull()
    expect(localMinuteOfDay(E, '   ')).toBeNull()
  })

  it('isQuietedNow：不跨午夜区间 [start,end)', () => {
    expect(isQuietedNow(qh({ startMinute: 540, endMinute: 1020, tz: 'UTC' }), E)).toBe(true)  // 930 ∈ [540,1020)
    expect(isQuietedNow(qh({ startMinute: 1020, endMinute: 1320, tz: 'UTC' }), E)).toBe(false) // 930 ∉ [1020,1320)
    expect(isQuietedNow(qh({ startMinute: 930, endMinute: 1020, tz: 'UTC' }), E)).toBe(true)   // 含 start
    expect(isQuietedNow(qh({ startMinute: 540, endMinute: 930, tz: 'UTC' }), E)).toBe(false)   // 不含 end（右开）
  })

  it('isQuietedNow：跨午夜 [22:00,07:00) = [1320,1440)∪[0,420)', () => {
    // 上海本地 23:30(1410) 落在夜间勿扰内
    expect(isQuietedNow(qh({ startMinute: 1320, endMinute: 420, tz: 'Asia/Shanghai' }), E)).toBe(true)
    // UTC 本地 09:30(930) 不在夜间勿扰内
    expect(isQuietedNow(qh({ startMinute: 1320, endMinute: 420, tz: 'UTC' }), E)).toBe(false)
    // 纽约本地 10:30(630)：凌晨窗 [1380, 480) 含 630？630<480? 否 → false
    expect(isQuietedNow(qh({ startMinute: 1380, endMinute: 480, tz: 'America/New_York' }), E)).toBe(false)
    // 纽约本地 10:30(630)：日间窗 [600,700) 含 630 → true
    expect(isQuietedNow(qh({ startMinute: 600, endMinute: 700, tz: 'America/New_York' }), E)).toBe(true)
  })

  it('isQuietedNow：fail-open（未启用/非法配置/start==end/非法 tz 一律 false）', () => {
    expect(isQuietedNow(undefined, E)).toBe(false)
    expect(isQuietedNow(qh({ enabled: false, startMinute: 540, endMinute: 1020 }), E)).toBe(false)
    expect(isQuietedNow(qh({ startMinute: -1, endMinute: 1020 }), E)).toBe(false)
    expect(isQuietedNow(qh({ startMinute: 540, endMinute: 1440 }), E)).toBe(false)
    expect(isQuietedNow(qh({ startMinute: 600, endMinute: 600 }), E)).toBe(false) // 空区间
    expect(isQuietedNow(qh({ startMinute: 0, endMinute: 1439, tz: 'Bad/Zone' }), E)).toBe(false)
    // 缺 tz（陈旧/损坏 JSON 行 enabled 却无 tz）：绝不用服务器时区误判勿扰而吞盲人通知 → fail-open false。
    expect(isQuietedNow(qh({ startMinute: 540, endMinute: 1020, tz: undefined as unknown as string }), E)).toBe(false)
  })

  it('isAlwaysThrough：紧急/来电/SOS/安全报到/账号安全告警恒推送；软通知可勿扰', () => {
    // 含安全报到类（safety_checkin_expired 等）：纵深防御，与"安全类不被静默"初衷对齐（复审 LOW#1）。
    // 含账号安全告警（security_*）：改密/关 2FA/换邮箱=潜在接管信号，须即时察觉，越过勿扰（行业通例）。
    for (const k of ['emergency_alert', 'emergency_ack', 'incoming_call', 'sos', 'escalate', 'safety_checkin_expired', 'checkin_missed',
                     'security_password_changed', 'security_2fa_disabled', 'security_email_changed', 'security_password_reset', 'security_phone_changed',
                     'security_username_changed', 'security_apple_linked', 'security_apple_unlinked']) expect(isAlwaysThrough(k)).toBe(true)
    for (const k of ['chat_message', 'friend_request', 'route_added', 'place_arrival', 'kyc_verified', 'recall', 'medical_info_viewed']) expect(isAlwaysThrough(k)).toBe(false)
  })

  it('账号安全告警在勿扰时段内也照常推送横幅（接管信号须即时触达，不拖到次日）', () => {
    const q = qh({ startMinute: 540, endMinute: 1020, tz: 'UTC' }) // E(930) 在勿扰内
    expect(shouldSuppressPush(q, 'security_password_changed', E)).toBe(false) // 改密告警勿扰中也推
    expect(shouldSuppressPush(q, 'security_2fa_disabled', E)).toBe(false)     // 关 2FA 告警勿扰中也推
    expect(shouldSuppressPush(q, 'medical_info_viewed', E)).toBe(true)        // 医疗被查看（透明通知，非接管）仍可勿扰
  })

  it('shouldSuppressPush：始终推送类不被抑制；可勿扰类仅在时段内抑制', () => {
    const q = qh({ startMinute: 540, endMinute: 1020, tz: 'UTC' }) // E(930) 在内
    expect(shouldSuppressPush(q, 'emergency_alert', E)).toBe(false) // 紧急永不抑制，哪怕勿扰中
    expect(shouldSuppressPush(q, 'chat_message', E)).toBe(true)     // 软通知：勿扰中抑制
    expect(shouldSuppressPush(qh({ startMinute: 1020, endMinute: 1320, tz: 'UTC' }), 'chat_message', E)).toBe(false) // 时段外不抑制
  })
})

// 覆盖 UTC 当前分钟的宽窗（±120min），确定性地让"现在"落在勿扰内（避免 mock 时间）。
function windowCoveringNow(cover: boolean): QuietHours {
  const cur = localMinuteOfDay(Date.now(), 'UTC')!
  return cover
    ? { enabled: true, startMinute: (cur - 120 + 1440) % 1440, endMinute: (cur + 120) % 1440, tz: 'UTC' }
    : { enabled: true, startMinute: (cur + 120) % 1440, endMinute: (cur + 240) % 1440, tz: 'UTC' }
}
class RecPush implements PushSender {
  alerts: string[] = []
  async sendCallInvite(): Promise<void> { /* 无关 */ }
  async sendAlert(_t: string, title: string): Promise<void> { this.alerts.push(title) }
}
class RecWebPush implements WebPushSender { configured = true; sent: string[] = []; async send(_sub: unknown, payload: string): Promise<void> { this.sent.push(payload) } }

describe('notifyUser 勿扰门（软通知抑制推送但仍持久化；紧急恒推送）', () => {
  afterEach(() => setNotifyWebPush(new NoopWebPushSender()))
  function seed(q: QuietHours) {
    const store = new MemoryStore()
    store.createUser({ id: 'u1', username: 'u1', passwordHash: hashPassword('secret123'), displayName: 'U', role: 'blind', status: 'active', createdAt: 1, apnsToken: 'tok', quietHours: q })
    store.upsertWebPushSubscription({ endpoint: 'https://e', userId: 'u1', p256dh: 'p', auth: 'a', createdAt: 1 })
    const web = new RecWebPush(); setNotifyWebPush(web)
    return { store, web }
  }

  it('勿扰时段内软通知：站内通知照常持久化，但 APNs/WebPush 横幅被抑制', () => {
    const { store, web } = seed(windowCoveringNow(true))
    const push = new RecPush()
    notifyUser(store, push, 'u1', 'friend_request', 'T', 'B')
    expect(store.notificationsForUser('u1')).toHaveLength(1) // 持久化不受影响（醒来可见）
    expect(push.alerts).toHaveLength(0) // APNs 横幅抑制
    expect(web.sent).toHaveLength(0)    // WebPush 横幅抑制
  })

  it('勿扰时段内紧急类：始终推送（isAlwaysThrough 兜底，纵深防御）', () => {
    const { store, web } = seed(windowCoveringNow(true))
    const push = new RecPush()
    notifyUser(store, push, 'u1', 'emergency_alert', 'T', 'B')
    expect(push.alerts).toHaveLength(1)
    expect(web.sent).toHaveLength(1)
  })

  it('非勿扰时段：软通知照常推送', () => {
    const { store, web } = seed(windowCoveringNow(false))
    const push = new RecPush()
    notifyUser(store, push, 'u1', 'friend_request', 'T', 'B')
    expect(push.alerts).toHaveLength(1)
    expect(web.sent).toHaveLength(1)
  })
})

describe('聊天推送遵守勿扰（消息仍存库，仅横幅抑制）', () => {
  it('收件人勿扰中：单聊消息已存库（收件人可拉取），但不推送横幅', async () => {
    const push = new RecPush()
    const store = new MemoryStore()
    const app = buildApp(store, { pushSender: push })
    const reg = async (u: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role: 'blind' } })).json()
    const a = await reg('qha'); const b = await reg('qhb')
    // 互链
    const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${a.token}` }, payload: { username: 'qhb', relation: '家人', isEmergency: false } })
    await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: { authorization: `Bearer ${b.token}` } })
    // 给收件人 b 一个 APNs token + 覆盖当前的勿扰窗
    store.updateUser(b.user.id, { apnsToken: 'btok', quietHours: windowCoveringNow(true) })

    const send = await app.inject({ method: 'POST', url: '/api/messages', headers: { authorization: `Bearer ${a.token}` }, payload: { toId: b.user.id, text: '在吗' } })
    expect(send.statusCode).toBe(201)
    // 消息已存库：收件人能拉取到
    const inbox = await app.inject({ method: 'GET', url: `/api/messages?with=${a.user.id}`, headers: { authorization: `Bearer ${b.token}` } })
    expect(inbox.json().messages.some((m: { text: string }) => m.text === '在吗')).toBe(true)
    expect(push.alerts).toHaveLength(0) // 勿扰中不推横幅

    // 关闭勿扰后再发：推送恢复
    store.updateUser(b.user.id, { quietHours: windowCoveringNow(false) })
    await app.inject({ method: 'POST', url: '/api/messages', headers: { authorization: `Bearer ${a.token}` }, payload: { toId: b.user.id, text: '第二条' } })
    expect(push.alerts).toHaveLength(1)
    await app.close()
  })
})

describe('勿扰时段端点 /api/notifications/quiet-hours', () => {
  async function auth() {
    const store = new MemoryStore()
    const app = buildApp(store)
    const reg = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'qhu', password: 'secret123', role: 'blind' } })).json()
    return { app, store, h: { authorization: `Bearer ${reg.token}` }, id: reg.user.id as string }
  }

  it('PUT 设置 + GET 读取；tz 非法 400；分钟越界 400；无鉴权 401', async () => {
    const { app, h } = await auth()
    const put = await app.inject({ method: 'PUT', url: '/api/notifications/quiet-hours', headers: h, payload: { enabled: true, startMinute: 1320, endMinute: 420, tz: 'Asia/Shanghai' } })
    expect(put.statusCode).toBe(200)
    expect(put.json().quietHours).toMatchObject({ enabled: true, startMinute: 1320, endMinute: 420, tz: 'Asia/Shanghai' })
    const get = await app.inject({ method: 'GET', url: '/api/notifications/quiet-hours', headers: h })
    expect(get.json().quietHours.startMinute).toBe(1320)

    expect((await app.inject({ method: 'PUT', url: '/api/notifications/quiet-hours', headers: h, payload: { enabled: true, startMinute: 0, endMinute: 60, tz: 'Bad/Zone' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/notifications/quiet-hours', headers: h, payload: { enabled: true, startMinute: 0, endMinute: 1500, tz: 'UTC' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/notifications/quiet-hours', payload: { enabled: true, startMinute: 0, endMinute: 60, tz: 'UTC' } })).statusCode).toBe(401)
    await app.close()
  })

  it('设置的勿扰跨 Sqlite 往返不丢（parity）', async () => {
    const { SqliteStore } = await import('../src/db/sqliteStore')
    const store = new SqliteStore(':memory:')
    store.createUser({ id: 'x', username: 'x', passwordHash: hashPassword('secret123'), displayName: 'X', role: 'blind', status: 'active', createdAt: 1, quietHours: { enabled: true, startMinute: 1320, endMinute: 420, tz: 'Asia/Shanghai' } })
    expect(store.findById('x')!.quietHours).toEqual({ enabled: true, startMinute: 1320, endMinute: 420, tz: 'Asia/Shanghai' })
    store.updateUser('x', { quietHours: { enabled: false, startMinute: 0, endMinute: 1, tz: 'UTC' } })
    expect(store.findById('x')!.quietHours).toMatchObject({ enabled: false })
  })
})
