import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

async function token(app: ReturnType<typeof buildApp>) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'navuser', password: 'secret123' } })
  return r.json().token as string
}

describe('AMap walking nav proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.AMAP_API_KEY
  })

  it('503 when AMAP key not configured', async () => {
    delete process.env.AMAP_API_KEY
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({
      method: 'GET',
      url: '/api/nav/walking?originLat=39.9&originLon=116.4&destination=天安门',
      headers: { authorization: `Bearer ${t}` },
    })
    expect(res.statusCode).toBe(503)
    await app.close()
  })

  it('rejects non-finite / empty / out-of-range coordinates (400, 不从 Null Island 起算)', async () => {
    process.env.AMAP_API_KEY = 'testkey'
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const auth = { authorization: `Bearer ${t}` }
    for (const q of ['originLat=Infinity&originLon=Infinity&destination=x', 'originLat=&originLon=&destination=x', 'originLat=999&originLon=116&destination=x']) {
      const res = await app.inject({ method: 'GET', url: `/api/nav/walking?${q}`, headers: auth })
      expect(res.statusCode).toBe(400)
    }
    await app.close()
  })

  it('returns parsed steps when configured (mocked AMap)', async () => {
    process.env.AMAP_API_KEY = 'testkey'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () =>
        url.includes('geocode')
          ? { status: '1', infocode: '10000', geocodes: [{ location: '116.397,39.908' }] }
          : { status: '1', infocode: '10000', route: { paths: [{ steps: [{ instruction: '向北步行', distance: '120' }, { instruction: '到达目的地', distance: '0' }] }] } },
    })))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({
      method: 'GET',
      url: '/api/nav/walking?originLat=39.9&originLon=116.4&destination=天安门',
      headers: { authorization: `Bearer ${t}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.destination).toBe('116.397,39.908')
    expect(body.steps[0]).toMatchObject({ instruction: '向北步行', distanceMeters: 120 })
    expect(body.steps.length).toBe(2)
    await app.close()
  })

  it('AMap key 平台不符 → 502 amap_error + infocode（区别于 destination_not_found，不误导用户改地址）', async () => {
    process.env.AMAP_API_KEY = 'ios_sdk_key'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ status: '0', info: 'USERKEY_PLAT_NOMATCH', infocode: '10009' }),
    })))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({
      method: 'GET',
      url: '/api/nav/walking?originLat=39.9&originLon=116.4&destination=天安门',
      headers: { authorization: `Bearer ${t}` },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({ error: 'amap_error', infocode: '10009' })
    await app.close()
  })

  it('地址真的查不到（status=1 但 geocodes 空）→ 404 destination_not_found', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ status: '1', infocode: '10000', geocodes: [] }),
    })))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({
      method: 'GET',
      url: '/api/nav/walking?originLat=39.9&originLon=116.4&destination=不存在的地方xyz',
      headers: { authorization: `Bearer ${t}` },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: 'destination_not_found' })
    await app.close()
  })

  it('给了 destLat/destLon → 跳过 geocode，直接按精确坐标路由（聊天分享位置精确导航，绝不按名字搜命中别处，复审#8/#9）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('geocode')) throw new Error('geocode 不应被调用：给了精确坐标就直接路由')
      return { ok: true, status: 200,
        json: async () => ({ status: '1', infocode: '10000', route: { paths: [{ steps: [{ instruction: '到达目的地', distance: '0' }] }] } }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({
      method: 'GET',
      url: '/api/nav/walking?originLat=39.9&originLon=116.4&destLat=39.908&destLon=116.397',
      headers: { authorization: `Bearer ${t}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.destination).toBe('116.397,39.908') // 高德序：经度,纬度
    expect(body.destinationLat).toBe(39.908)
    expect(body.destinationLon).toBe(116.397)
    expect(fetchMock.mock.calls.every(([u]) => !String(u).includes('geocode'))).toBe(true) // 全程零 geocode 调用
    await app.close()
  })

  it('既无 destination 也无 destLat/destLon → 400（refine 兜底，二者必传其一）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({
      method: 'GET',
      url: '/api/nav/walking?originLat=39.9&originLon=116.4',
      headers: { authorization: `Bearer ${t}` },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
