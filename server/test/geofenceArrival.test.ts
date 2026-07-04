import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

async function setup() {
  const store = new MemoryStore()
  const app = buildApp(store)
  const reg = async (u: string, role: string) => {
    const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    return { id: r.user.id as string, h: { authorization: `Bearer ${r.token}` } }
  }
  const blind = await reg('geoblind', 'blind')
  const family = await reg('geofamily', 'family')
  const stranger = await reg('geostranger', 'helper')
  const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: blind.h,
    payload: { username: 'geofamily', relation: '家人', isEmergency: false } })
  await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: family.h })
  return { app, store, blind, family, stranger }
}
const arrivals = (store: MemoryStore, uid: string) =>
  store.notificationsForUser(uid).filter((n) => n.kind === 'place_arrival')

describe('到达围栏提醒（geofence：到家/公司通知家人）', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.AMAP_API_KEY })

  it('保存地点时 geocode 缓存坐标：GCJ-02 转回 WGS-84 存（best-effort）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ status: '1', infocode: '10000', geocodes: [{ location: '116.4137,39.9056' }] }) })))
    const { app, blind } = await setup()
    const res = await app.inject({ method: 'PUT', url: '/api/places/home', headers: blind.h, payload: { address: '北京市朝阳区某路' } })
    expect(res.statusCode).toBe(200)
    const place = res.json().place
    // GCJ 116.4137,39.9056 → WGS 约 116.407,39.904（反纠偏几百米）；只验落在北京范围（精确算法见 chinaCoord.test）。
    expect(place.lat).toBeGreaterThan(39.89); expect(place.lat).toBeLessThan(39.92)
    expect(place.lng).toBeGreaterThan(116.39); expect(place.lng).toBeLessThan(116.42)
    await app.close()
  })

  it('地址查不到 / 未配 amap → 无坐标，地点照存不报错', async () => {
    const { app, blind } = await setup() // 未设 AMAP_API_KEY → amapGeocode 返回 undefined
    const res = await app.inject({ method: 'PUT', url: '/api/places/home', headers: blind.h, payload: { address: '家' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().place.lat).toBeUndefined()
    await app.close()
  })

  it('盲人到达已存坐标的家 → 家人收到 place_arrival；停留不重复；离开再回再报', async () => {
    const { app, store, blind, family, stranger } = await setup()
    store.upsertSavedPlace({ ownerId: blind.id, label: 'home', address: '家', lat: 39.9042, lng: 116.4074, updatedAt: Date.now() })
    const update = (lat: number, lng: number) => app.inject({ method: 'POST', url: '/api/locations/update', headers: blind.h, payload: { lat, lng } })

    await update(39.9042, 116.4074) // 到家
    expect(arrivals(store, family.id)).toHaveLength(1)
    expect(arrivals(store, family.id)[0].data?.label).toBe('home')
    expect(arrivals(store, stranger.id)).toHaveLength(0) // 非互链陌生人绝不收到（授权=accepted 联系人）

    await update(39.9042, 116.4074) // 停留：去重
    expect(arrivals(store, family.id)).toHaveLength(1)

    await update(39.9042, 116.42)   // 离开（约 1km > exit 200m）
    await update(39.9042, 116.4074) // 回家 → 再报
    expect(arrivals(store, family.id)).toHaveLength(2)
    await app.close()
  })

  it('无坐标的地点不触发；位置更新照常返回', async () => {
    const { app, store, blind, family } = await setup()
    store.upsertSavedPlace({ ownerId: blind.id, label: 'work', address: '公司', updatedAt: Date.now() }) // 无坐标
    const res = await app.inject({ method: 'POST', url: '/api/locations/update', headers: blind.h, payload: { lat: 39.9042, lng: 116.4074 } })
    expect(res.statusCode).toBe(200)
    expect(arrivals(store, family.id)).toHaveLength(0)
    await app.close()
  })
})
