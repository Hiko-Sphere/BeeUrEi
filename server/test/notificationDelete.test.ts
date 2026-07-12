import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })

async function setup() {
  const store = new MemoryStore()
  const app = buildApp(store)
  const reg = async (u: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'strong-pass-9x', role: 'blind' } })).json()
  const alice = await reg('alice')
  const bob = await reg('bob')
  return { app, store, alice, bob }
}
const seed = (store: MemoryStore, userId: string, id: string, createdAt: number) =>
  store.createNotification({ id, userId, kind: 'report_resolved', title: `t-${id}`, body: `b-${id}`, createdAt })
const kinds = async (app: ReturnType<typeof buildApp>, h: Record<string, string>) =>
  (await app.inject({ method: 'GET', url: '/api/notifications', headers: h })).json().notifications.map((n: { id: string }) => n.id)

describe('DELETE /api/notifications/:id 单条删除（仅本人）', () => {
  it('本人可删自己的单条；删后列表不再含它；幂等重复删仍 204', async () => {
    const { app, store, alice } = await setup()
    const h = auth(alice.token)
    seed(store, alice.user.id, 'n1', 1); seed(store, alice.user.id, 'n2', 2)
    expect(await kinds(app, h)).toEqual(['n2', 'n1']) // 时间倒序
    expect((await app.inject({ method: 'DELETE', url: '/api/notifications/n1', headers: h })).statusCode).toBe(204)
    expect(await kinds(app, h)).toEqual(['n2'])
    expect((await app.inject({ method: 'DELETE', url: '/api/notifications/n1', headers: h })).statusCode).toBe(204) // 幂等
    await app.close()
  })

  it('非本人删不动他人通知（204 no-op，不泄露存在性，实际未删）', async () => {
    const { app, store, alice, bob } = await setup()
    seed(store, bob.user.id, 'bob-note', 1)
    // alice 尝试删 bob 的通知 → 204，但 bob 的通知仍在。
    expect((await app.inject({ method: 'DELETE', url: '/api/notifications/bob-note', headers: auth(alice.token) })).statusCode).toBe(204)
    expect(await kinds(app, auth(bob.token))).toEqual(['bob-note'])
    await app.close()
  })

  it('需登录：匿名 401', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'DELETE', url: '/api/notifications/x' })).statusCode).toBe(401)
    await app.close()
  })
})

describe('POST /api/notifications/clear-read 清空已读（保留未读）', () => {
  it('只清已读、保留未读；返回清除条数', async () => {
    const { app, store, alice } = await setup()
    const h = auth(alice.token)
    seed(store, alice.user.id, 'r1', 1); seed(store, alice.user.id, 'r2', 2); seed(store, alice.user.id, 'u3', 3)
    // 标记 r1、r2 已读，u3 保持未读。
    await app.inject({ method: 'POST', url: '/api/notifications/r1/read', headers: h })
    await app.inject({ method: 'POST', url: '/api/notifications/r2/read', headers: h })
    const res = await app.inject({ method: 'POST', url: '/api/notifications/clear-read', headers: h })
    expect(res.json().cleared).toBe(2)
    expect(await kinds(app, h)).toEqual(['u3']) // 未读保留
    await app.close()
  })

  it('无已读 → cleared:0，通知不动', async () => {
    const { app, store, alice } = await setup()
    const h = auth(alice.token)
    seed(store, alice.user.id, 'u1', 1)
    expect((await app.inject({ method: 'POST', url: '/api/notifications/clear-read', headers: h })).json().cleared).toBe(0)
    expect(await kinds(app, h)).toEqual(['u1'])
    await app.close()
  })
})

describe('删除通知存储 parity（Memory ↔ Sqlite 行为一致）', () => {
  for (const make of [() => new MemoryStore(), () => new SqliteStore(':memory:')]) {
    const name = make().constructor.name
    it(`${name}: deleteNotification 仅本人；deleteReadNotificationsForUser 只删已读`, () => {
      const s = make()
      s.createNotification({ id: 'a', userId: 'me', kind: 'k', title: 't', body: 'b', createdAt: 1 })
      s.createNotification({ id: 'b', userId: 'me', kind: 'k', title: 't', body: 'b', createdAt: 2 })
      s.createNotification({ id: 'c', userId: 'other', kind: 'k', title: 't', body: 'b', createdAt: 3 })
      expect(s.deleteNotification('c', 'me')).toBe(false) // 非本人 → false，未删
      expect(s.findNotification('c')).toBeTruthy()
      expect(s.deleteNotification('a', 'me')).toBe(true)
      expect(s.findNotification('a')).toBeUndefined()
      // b 未读、d 已读 → 清已读只删 d
      s.createNotification({ id: 'd', userId: 'me', kind: 'k', title: 't', body: 'b', createdAt: 4 })
      s.markNotificationRead('d', 'me')
      expect(s.deleteReadNotificationsForUser('me')).toBe(1) // 只 d（b 仍未读）
      expect(s.findNotification('b')).toBeTruthy()
      expect(s.findNotification('d')).toBeUndefined()
    })

    it(`${name}: notificationsForUser 游标翻页（before/beforeId）无漏无重、同刻 tie-break 稳定`, () => {
      const s = make()
      const seed = (id: string, createdAt: number) => s.createNotification({ id, userId: 'me', kind: 'k', title: 't', body: 'b', createdAt })
      seed('n1', 1000); seed('n2', 2000); seed('n3', 3000); seed('n4a', 4000); seed('n4b', 4000) // n4a/n4b 同刻
      const p1 = s.notificationsForUser('me', 2)
      expect(p1.map((n) => n.id)).toEqual(['n4b', 'n4a']) // 最新在前；同刻按 id 降序
      const l1 = p1[1]
      const p2 = s.notificationsForUser('me', 2, l1.createdAt, l1.id)
      expect(p2.map((n) => n.id)).toEqual(['n3', 'n2']) // 跨同刻边界无漏无重
      const l2 = p2[1]
      const p3 = s.notificationsForUser('me', 2, l2.createdAt, l2.id)
      expect(p3.map((n) => n.id)).toEqual(['n1'])
      // 并集恰为全部 5、无重复。
      const all = [...p1, ...p2, ...p3].map((n) => n.id)
      expect(new Set(all).size).toBe(5)
      expect(all).toEqual(['n4b', 'n4a', 'n3', 'n2', 'n1'])
    })
  }
})

describe('通知列表端点游标分页 + hasMore（silent cap 修复：不再只见最近 100 条）', () => {
  it('/api/notifications 支持 limit + before/beforeId 翻页，hasMore 精确到底转 false', async () => {
    const { app, store, alice } = await setup()
    for (let i = 1; i <= 5; i++) seed(store, alice.user.id, `m${i}`, i * 1000)
    const h = auth(alice.token)
    const get = async (qs = '') => (await app.inject({ method: 'GET', url: `/api/notifications${qs}`, headers: h })).json()
    const p1 = await get('?limit=2')
    expect(p1.notifications.map((n: { id: string }) => n.id)).toEqual(['m5', 'm4'])
    expect(p1.hasMore).toBe(true)
    expect(p1.unread).toBe(5) // unread 计数**全量**（不随分页窗口变）——正是此前"计数有数、列表找不到"的根因场景
    const last1 = p1.notifications[1]
    const p2 = await get(`?limit=2&before=${last1.createdAt}&beforeId=${last1.id}`)
    expect(p2.notifications.map((n: { id: string }) => n.id)).toEqual(['m3', 'm2'])
    expect(p2.hasMore).toBe(true)
    const last2 = p2.notifications[1]
    const p3 = await get(`?limit=2&before=${last2.createdAt}&beforeId=${last2.id}`)
    expect(p3.notifications.map((n: { id: string }) => n.id)).toEqual(['m1'])
    expect(p3.hasMore).toBe(false) // 到底
    await app.close()
  })
})
