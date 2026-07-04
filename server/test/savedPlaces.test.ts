import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type Store } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { cascadeDeleteUser } from '../src/db/cascade'

async function token(app: ReturnType<typeof buildApp>, username = 'placeuser') {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  return { token: r.json().token as string, id: r.json().user.id as string }
}

describe('保存的地点（家/公司/自定义）', () => {
  it('upsert 家/公司、列出、按 label 覆盖、删除、上限', async () => {
    const app = buildApp(new MemoryStore())
    const { token: t } = await token(app)
    const auth = { authorization: `Bearer ${t}` }

    // 新增家
    let res = await app.inject({ method: 'PUT', url: '/api/places/home', headers: auth, payload: { address: '北京市朝阳区xx路1号' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().place).toMatchObject({ label: 'home', address: '北京市朝阳区xx路1号' })
    // 新增公司
    await app.inject({ method: 'PUT', url: '/api/places/work', headers: auth, payload: { address: '国贸大厦' } })
    // 列出（updatedAt 倒序，最新在前）
    res = await app.inject({ method: 'GET', url: '/api/places', headers: auth })
    expect(res.json().places.map((p: { label: string }) => p.label)).toEqual(['work', 'home'])
    // 同 label 覆盖（不新增第二条 home）
    await app.inject({ method: 'PUT', url: '/api/places/home', headers: auth, payload: { address: '新家地址' } })
    res = await app.inject({ method: 'GET', url: '/api/places', headers: auth })
    const homes = res.json().places.filter((p: { label: string }) => p.label === 'home')
    expect(homes).toHaveLength(1)
    expect(homes[0].address).toBe('新家地址')
    // 删除公司
    await app.inject({ method: 'DELETE', url: '/api/places/work', headers: auth })
    res = await app.inject({ method: 'GET', url: '/api/places', headers: auth })
    expect(res.json().places.map((p: { label: string }) => p.label)).toEqual(['home'])
    await app.close()
  })

  it('校验：空地址/超长/违禁词/未登录', async () => {
    const store = new MemoryStore()
    store.setAppConfig({ contentFilter: { enabled: true, terms: ['敏感词'] } })
    const app = buildApp(store)
    const { token: t } = await token(app)
    const auth = { authorization: `Bearer ${t}` }
    expect((await app.inject({ method: 'PUT', url: '/api/places/home', headers: auth, payload: { address: '' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/places/home', headers: auth, payload: { address: 'x'.repeat(201) } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/places/home', headers: auth, payload: { address: '这里有敏感词' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/places' })).statusCode).toBe(401) // 无 token
    await app.close()
  })

  it('每人地点上限 30；更新已有 label 不占新名额', async () => {
    const app = buildApp(new MemoryStore())
    const { token: t } = await token(app)
    const auth = { authorization: `Bearer ${t}` }
    for (let i = 0; i < 30; i++) {
      const r = await app.inject({ method: 'PUT', url: `/api/places/p${i}`, headers: auth, payload: { address: `addr${i}` } })
      expect(r.statusCode).toBe(200)
    }
    // 第 31 个新 label → 429
    expect((await app.inject({ method: 'PUT', url: '/api/places/p30', headers: auth, payload: { address: 'a' } })).statusCode).toBe(429)
    // 更新已有 label → 仍可
    expect((await app.inject({ method: 'PUT', url: '/api/places/p0', headers: auth, payload: { address: 'updated' } })).statusCode).toBe(200)
    await app.close()
  })

  it('只见自己的地点（无跨用户泄露）', async () => {
    const app = buildApp(new MemoryStore())
    const a = await token(app, 'alice')
    const b = await token(app, 'bob')
    await app.inject({ method: 'PUT', url: '/api/places/home', headers: { authorization: `Bearer ${a.token}` }, payload: { address: 'alice家' } })
    const res = await app.inject({ method: 'GET', url: '/api/places', headers: { authorization: `Bearer ${b.token}` } })
    expect(res.json().places).toEqual([]) // bob 看不到 alice 的
    await app.close()
  })

  it('删号级联清除其地点', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const { token: t, id } = await token(app)
    await app.inject({ method: 'PUT', url: '/api/places/home', headers: { authorization: `Bearer ${t}` }, payload: { address: '家' } })
    expect(store.savedPlacesForUser(id)).toHaveLength(1)
    cascadeDeleteUser(store, id)
    expect(store.savedPlacesForUser(id)).toEqual([])
    await app.close()
  })

  it('MemoryStore 与 SqliteStore 语义一致（parity：upsert 覆盖 / forUser 排序 / 删除 / 级联）', () => {
    const check = (store: Store) => {
      store.upsertSavedPlace({ ownerId: 'u1', label: 'home', address: 'A', updatedAt: 100 })
      store.upsertSavedPlace({ ownerId: 'u1', label: 'work', address: 'B', updatedAt: 200 })
      store.upsertSavedPlace({ ownerId: 'u2', label: 'home', address: 'C', updatedAt: 150 })
      // 覆盖（同 ownerId+label）
      store.upsertSavedPlace({ ownerId: 'u1', label: 'home', address: 'A2', updatedAt: 300 })
      const u1 = store.savedPlacesForUser('u1')
      expect(u1.map((p) => `${p.label}:${p.address}`)).toEqual(['home:A2', 'work:B']) // updatedAt 倒序，home 覆盖为 A2
      expect(store.savedPlacesForUser('u2').map((p) => p.address)).toEqual(['C']) // 不跨用户
      store.deleteSavedPlace('u1', 'work')
      expect(store.savedPlacesForUser('u1').map((p) => p.label)).toEqual(['home'])
      store.deleteSavedPlacesForOwner('u1')
      expect(store.savedPlacesForUser('u1')).toEqual([])
      expect(store.savedPlacesForUser('u2')).toHaveLength(1) // 只清 u1
    }
    check(new MemoryStore())
    check(new SqliteStore(':memory:') as unknown as Store)
  })
})
