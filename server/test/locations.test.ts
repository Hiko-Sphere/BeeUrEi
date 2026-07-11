import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

async function register(app: ReturnType<typeof buildApp>, username: string, role: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123', role } })
  const b = r.json()
  return { token: b.token as string, id: b.user.id as string }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

/// 建立 A(blind) 与 B 的已接受绑定。
async function link(app: ReturnType<typeof buildApp>, a: { token: string }, bId: string, bToken: string) {
  const created = await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(a.token), payload: { userId: bId } })
  const linkId = created.json().link.id as string
  await app.inject({ method: 'POST', url: `/api/family/links/${linkId}/accept`, headers: auth(bToken) })
}

describe('实时位置共享 /api/locations', () => {
  it('已绑定双方互相可见；上报→对方看到，stop→不可见', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const A = await register(app, 'loc_a', 'blind')
    const B = await register(app, 'loc_b', 'helper')
    await link(app, A, B.id, B.token)

    // B 上报位置（含电量）→ A 在 /contacts 中看到 B 及其电量（亲友据此在其没电前主动联系）。
    await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(B.token), payload: { lat: 39.9, lng: 116.4, accuracy: 10, battery: 15 } })
    let res = await app.inject({ method: 'GET', url: '/api/locations/contacts', headers: auth(A.token) })
    expect(res.statusCode).toBe(200)
    let body = res.json()
    expect(body.contacts).toHaveLength(1)
    expect(body.contacts[0]).toMatchObject({ userId: B.id, lat: 39.9, lng: 116.4, battery: 15 })
    expect(body.sharing).toBe(false) // A 自己尚未共享

    // A 也上报（不带电量：老客户端）→ A.sharing=true，B 看到 A 且 battery=null（可选字段向后兼容）。
    await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(A.token), payload: { lat: 31.2, lng: 121.5 } })
    res = await app.inject({ method: 'GET', url: '/api/locations/contacts', headers: auth(A.token) })
    expect(res.json().sharing).toBe(true)
    res = await app.inject({ method: 'GET', url: '/api/locations/contacts', headers: auth(B.token) })
    expect(res.json().contacts[0]).toMatchObject({ userId: A.id, lat: 31.2, lng: 121.5, battery: null })

    // 越界电量被 schema 拒绝（不污染登记表）。
    const bad = await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(B.token), payload: { lat: 1, lng: 2, battery: 150 } })
    expect(bad.statusCode).toBe(400)

    // B 停止共享 → A 不再可见 B。
    await app.inject({ method: 'POST', url: '/api/locations/stop', headers: auth(B.token) })
    body = (await app.inject({ method: 'GET', url: '/api/locations/contacts', headers: auth(A.token) })).json()
    expect(body.contacts).toHaveLength(0)
    await app.close()
  })

  it('未绑定者的位置不可见（授权边界 = 已接受绑定）', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const A = await register(app, 'loc_a2', 'blind')
    const C = await register(app, 'loc_c2', 'helper') // 与 A 无任何绑定
    await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(C.token), payload: { lat: 1, lng: 2 } })
    const body = (await app.inject({ method: 'GET', url: '/api/locations/contacts', headers: auth(A.token) })).json()
    expect(body.contacts).toHaveLength(0)
    await app.close()
  })

  it('拉黑后互不可见（双向：拉黑方与被拉黑方都看不到对方位置）', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const A = await register(app, 'loc_a3', 'blind')
    const B = await register(app, 'loc_b3', 'helper')
    await link(app, A, B.id, B.token)
    // 双方都在共享位置。
    await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(B.token), payload: { lat: 5, lng: 6 } })
    await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(A.token), payload: { lat: 7, lng: 8 } })
    // A 拉黑 B（单向操作）。
    await app.inject({ method: 'POST', url: '/api/blocks', headers: auth(A.token), payload: { userId: B.id } })
    // 拉黑方 A 看不到 B。
    const aSees = (await app.inject({ method: 'GET', url: '/api/locations/contacts', headers: auth(A.token) })).json()
    expect(aSees.contacts).toHaveLength(0)
    // 关键回归防护：被拉黑方 B 也必须看不到 A。拉黑对位置可见性须双向生效——否则被拉黑者
    // 仍能追踪拉黑者实时位置（隐私泄露）。依赖 blockedUserIdSet 含"拉黑我的人"（双向）。
    const bSees = (await app.inject({ method: 'GET', url: '/api/locations/contacts', headers: auth(B.token) })).json()
    expect(bSees.contacts).toHaveLength(0)
    await app.close()
  })

  it('功能关闭时 update/contacts 返回 403', async () => {
    const store = new MemoryStore()
    store.setAppConfig({ features: { locationSharing: false } })
    const app = buildApp(store)
    const A = await register(app, 'loc_a4', 'blind')
    const up = await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(A.token), payload: { lat: 1, lng: 2 } })
    expect(up.statusCode).toBe(403)
    const ct = await app.inject({ method: 'GET', url: '/api/locations/contacts', headers: auth(A.token) })
    expect(ct.statusCode).toBe(403)
    await app.close()
  })

  it('拒绝非法坐标（NaN/越界）', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const A = await register(app, 'loc_a5', 'blind')
    for (const payload of [{ lat: 999, lng: 0 }, { lat: 0, lng: 999 }, { lat: 'x', lng: 0 }]) {
      const r = await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(A.token), payload })
      expect(r.statusCode).toBe(400)
    }
    await app.close()
  })
})

describe('请求共享位置 /api/locations/request（nudge，绝非远程强开）', () => {
  async function seed() {
    const store = new MemoryStore()
    const app = buildApp(store)
    const A = await register(app, 'req_a', 'family')
    const B = await register(app, 'req_b', 'blind')
    const C = await register(app, 'req_c', 'helper') // 陌生人（未绑定）
    await link(app, A, B.id, B.token)
    const notifs = (uid: string) => store.notificationsForUser(uid).filter((n) => n.kind === 'location_request')
    return { store, app, A, B, C, notifs }
  }

  it('已绑定联系人请求 → 对方收到 location_request 通知（含请求者名，供对方决定）', async () => {
    const { app, A, B, notifs } = await seed()
    const r = await app.inject({ method: 'POST', url: '/api/locations/request', headers: auth(A.token), payload: { userId: B.id } })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ ok: true })
    const n = notifs(B.id)
    expect(n).toHaveLength(1)
    expect(n[0].title).toContain('req_a')                      // 是谁在请求
    expect(n[0].data).toMatchObject({ fromId: A.id })
    await app.close()
  })

  it('陌生人请求 → 403（防骚扰）；请求自己 → 400', async () => {
    const { app, B, C } = await seed()
    expect((await app.inject({ method: 'POST', url: '/api/locations/request', headers: auth(C.token), payload: { userId: B.id } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/locations/request', headers: auth(B.token), payload: { userId: B.id } })).statusCode).toBe(400)
    await app.close()
  })

  it('对方已在共享 → alreadySharing:true 且不发通知（本就可见，不打扰）', async () => {
    const { app, A, B, notifs } = await seed()
    await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(B.token), payload: { lat: 31.2, lng: 121.5 } })
    const r = await app.inject({ method: 'POST', url: '/api/locations/request', headers: auth(A.token), payload: { userId: B.id } })
    expect(r.json()).toMatchObject({ ok: true, alreadySharing: true })
    expect(notifs(B.id)).toHaveLength(0)
    await app.close()
  })

  it('闭合回路：A 请求 B → B 开始共享 → A 收到 location_share_started（含 B 名，去地图看）；共享期间再上报不重复反馈', async () => {
    const { store, app, A, B } = await seed()
    const shareNotifs = () => store.notificationsForUser(A.id).filter((n) => n.kind === 'location_share_started')
    await app.inject({ method: 'POST', url: '/api/locations/request', headers: auth(A.token), payload: { userId: B.id } })
    expect(shareNotifs()).toHaveLength(0) // B 还没共享 → 尚无反馈
    // B 响应、开始共享（本会话首次上报）→ 反馈请求者 A。
    await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(B.token), payload: { lat: 31.2, lng: 121.5 } })
    const n = shareNotifs()
    expect(n).toHaveLength(1)
    expect(n[0].title).toContain('req_b')             // "B 开始共享位置了"
    expect(n[0].data).toMatchObject({ fromId: B.id }) // 点击去地图看 B
    // 共享期间再次上报 → 不重复反馈（已 clear + 非首更新，isSharing 守卫）。
    await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(B.token), payload: { lat: 31.21, lng: 121.51 } })
    expect(shareNotifs()).toHaveLength(1)
    await app.close()
  })

  it('无人请求时开始共享 → 不发 location_share_started（只在有 pending 请求时反馈，不凭空打扰）', async () => {
    const { store, app, A, B } = await seed()
    await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(B.token), payload: { lat: 31.2, lng: 121.5 } })
    expect(store.notificationsForUser(A.id).filter((n) => n.kind === 'location_share_started')).toHaveLength(0)
    await app.close()
  })

  it('请求后、共享前互相拉黑 → 对方共享不反馈拉黑者（DV/骚扰：拉黑者不再收关于对方的通知，点开也因拉黑看不到）', async () => {
    const { store, app, A, B } = await seed()
    await app.inject({ method: 'POST', url: '/api/locations/request', headers: auth(A.token), payload: { userId: B.id } })
    store.createBlock({ id: 'blk-ab', blockerId: A.id, blockedId: B.id, createdAt: Date.now() }) // A 请求后拉黑 B
    await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(B.token), payload: { lat: 31.2, lng: 121.5 } })
    expect(store.notificationsForUser(A.id).filter((n) => n.kind === 'location_share_started')).toHaveLength(0) // 不反馈拉黑者
    await app.close()
  })

  it('同一对 5 分钟内重复请求 → deduped:true，通知只有一条（防 nudge 轰炸）', async () => {
    const { app, A, B, notifs } = await seed()
    expect((await app.inject({ method: 'POST', url: '/api/locations/request', headers: auth(A.token), payload: { userId: B.id } })).json()).toMatchObject({ ok: true })
    const again = await app.inject({ method: 'POST', url: '/api/locations/request', headers: auth(A.token), payload: { userId: B.id } })
    expect(again.json()).toMatchObject({ ok: true, deduped: true })
    expect(notifs(B.id)).toHaveLength(1)
    await app.close()
  })
})
