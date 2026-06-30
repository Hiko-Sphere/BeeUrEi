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

    // B 上报位置 → A 在 /contacts 中看到 B。
    await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(B.token), payload: { lat: 39.9, lng: 116.4, accuracy: 10 } })
    let res = await app.inject({ method: 'GET', url: '/api/locations/contacts', headers: auth(A.token) })
    expect(res.statusCode).toBe(200)
    let body = res.json()
    expect(body.contacts).toHaveLength(1)
    expect(body.contacts[0]).toMatchObject({ userId: B.id, lat: 39.9, lng: 116.4 })
    expect(body.sharing).toBe(false) // A 自己尚未共享

    // A 也上报 → A.sharing=true，且 B 能看到 A。
    await app.inject({ method: 'POST', url: '/api/locations/update', headers: auth(A.token), payload: { lat: 31.2, lng: 121.5 } })
    res = await app.inject({ method: 'GET', url: '/api/locations/contacts', headers: auth(A.token) })
    expect(res.json().sharing).toBe(true)
    res = await app.inject({ method: 'GET', url: '/api/locations/contacts', headers: auth(B.token) })
    expect(res.json().contacts[0]).toMatchObject({ userId: A.id, lat: 31.2, lng: 121.5 })

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
