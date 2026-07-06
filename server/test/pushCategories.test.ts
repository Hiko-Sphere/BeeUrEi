import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { notifyUser } from '../src/notifications/notify'
import type { PushSender } from '../src/push/apns'

class FakePush implements PushSender {
  sent: { title: string; body: string; extra?: Record<string, string> }[] = []
  async sendCallInvite(): Promise<void> {}
  async sendAlert(_t: string, title: string, body: string, extra?: Record<string, string>): Promise<void> {
    this.sent.push({ title, body, extra })
  }
}

function user(id: string, mutedPushCategories?: string[]) {
  return { id, username: id, passwordHash: 'h', displayName: id, role: 'blind', status: 'active', createdAt: 1, apnsToken: 't'.repeat(64), mutedPushCategories }
}

describe('按类别静音推送横幅（notifyUser 集成）', () => {
  it('静音 route → route_added 推送横幅被抑制，但站内通知照常持久化', () => {
    const store = new MemoryStore()
    store.createUser(user('u1', ['route']) as any)
    const push = new FakePush()
    notifyUser(store, push, 'u1', 'route_added', '有人为你加了路线', '家到菜场', { routeId: 'r1' })
    expect(push.sent).toHaveLength(0)                        // 推送横幅被静音
    expect(store.notificationsForUser('u1')).toHaveLength(1) // 站内通知仍在（可回看）
  })

  it('未静音的类别照常推送；静音一类不影响另一类', () => {
    const store = new MemoryStore()
    store.createUser(user('u2', ['route']) as any)
    const push = new FakePush()
    notifyUser(store, push, 'u2', 'place_arrival', '已到家', 'x')   // location 未静音 → 推
    notifyUser(store, push, 'u2', 'friend_request', '好友请求', 'x') // social 未静音 → 推
    notifyUser(store, push, 'u2', 'route_updated', '路线改了', 'x')  // route 静音 → 不推
    expect(push.sent.map((s) => s.title)).toEqual(['已到家', '好友请求'])
  })

  it('危急类无视静音一律推送：即便三类全静音，紧急/安全告警照推', () => {
    const store = new MemoryStore()
    store.createUser(user('u3', ['social', 'route', 'location']) as any)
    const push = new FakePush()
    notifyUser(store, push, 'u3', 'emergency_alert', 'SOS', 'x')
    notifyUser(store, push, 'u3', 'security_new_device', '新设备登录', 'x')
    expect(push.sent).toHaveLength(2) // 两条危急类都推了
  })
})

describe('按类别静音端点 /api/notifications/push-categories', () => {
  async function setup() {
    const app = buildApp(new MemoryStore())
    const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'blindu', password: 'secret123', role: 'blind' } })).json()
    return { app, h: { authorization: `Bearer ${r.token}` } }
  }

  it('默认空集 + 返回可选类别；PUT 设置后 GET 反映；去重/去非法/稳定序', async () => {
    const { app, h } = await setup()
    const g0 = (await app.inject({ method: 'GET', url: '/api/notifications/push-categories', headers: h })).json()
    expect(g0.muted).toEqual([])
    expect(g0.available).toEqual(['social', 'route', 'location'])

    // 乱序 + 重复提交 → 规整为稳定序、去重
    const put = await app.inject({ method: 'PUT', url: '/api/notifications/push-categories', headers: h, payload: { muted: ['route', 'social', 'route'] } })
    expect(put.statusCode).toBe(200)
    expect(put.json().muted).toEqual(['social', 'route'])
    const g1 = (await app.inject({ method: 'GET', url: '/api/notifications/push-categories', headers: h })).json()
    expect(g1.muted).toEqual(['social', 'route'])

    // 清空
    await app.inject({ method: 'PUT', url: '/api/notifications/push-categories', headers: h, payload: { muted: [] } })
    expect((await app.inject({ method: 'GET', url: '/api/notifications/push-categories', headers: h })).json().muted).toEqual([])
    await app.close()
  })

  it('非法类别（含危急类名）→ 400 拒绝（不可静音危急类）', async () => {
    const { app, h } = await setup()
    expect((await app.inject({ method: 'PUT', url: '/api/notifications/push-categories', headers: h, payload: { muted: ['emergency'] } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/notifications/push-categories', headers: h, payload: { muted: ['security'] } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/notifications/push-categories', headers: h, payload: { muted: 'route' } })).statusCode).toBe(400)
    await app.close()
  })

  it('需登录：匿名 401', async () => {
    const app = buildApp(new MemoryStore())
    expect((await app.inject({ method: 'GET', url: '/api/notifications/push-categories' })).statusCode).toBe(401)
    await app.close()
  })
})

describe('mutedPushCategories 存储 parity（Memory ↔ Sqlite 往返一致）', () => {
  it('Sqlite 往返保真：写入后重读得到同一集合；空集回读为 undefined', () => {
    const sq = new SqliteStore(':memory:')
    sq.createUser(user('s1', ['social', 'location']) as any)
    expect(sq.findById('s1')?.mutedPushCategories).toEqual(['social', 'location'])
    // 更新为空集 → 存 null → 回读 undefined（与 MemoryStore 无字段一致）
    sq.updateUser('s1', { mutedPushCategories: [] })
    expect(sq.findById('s1')?.mutedPushCategories).toBeUndefined()
    // 未设过的用户回读 undefined
    sq.createUser(user('s2') as any)
    expect(sq.findById('s2')?.mutedPushCategories).toBeUndefined()
  })
})
