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
    delete process.env.AMAP_TIMEOUT_MS
  })

  it('高德慢/挂 → AbortController 硬超时快速失败（不无限期挂住服务端连接，慢上游型 DoS 防护）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    process.env.AMAP_TIMEOUT_MS = '50' // 测试用短超时
    // fetch 永不 resolve，只在 abort 触发时 reject（模拟高德挂起）；无超时则本测试会挂到 vitest 5s 兜底而失败。
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({ method: 'GET', url: '/api/nav/around?lat=39.9&lon=116.4', headers: { authorization: `Bearer ${t}` } })
    expect(res.statusCode).toBe(502) // 超时中止 → nav_unavailable，而非 200 或永久挂起
    expect(res.json()).toMatchObject({ error: 'nav_unavailable' })
    await app.close()
  })

  it('高德瞬时网络抖动 → 自动重试一次透明恢复（盲人无感；语义错误与超时不重试）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string) => {
      calls++
      if (calls === 1) throw new TypeError('network error') // 首次纯网络抖动（非超时、非 amap 语义错误）
      return { ok: true, status: 200, json: async () => ({ status: '1', infocode: '10000',
        pois: [{ name: '便利店', location: '116.4,39.9', distance: '30', type: '便民商店;便利店' }] }) }
    }))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({ method: 'GET', url: '/api/nav/around?lat=39.9&lon=116.4', headers: { authorization: `Bearer ${t}` } })
    expect(res.statusCode).toBe(200) // 重试后成功
    expect(res.json().pois).toHaveLength(1)
    expect(calls).toBe(2) // 恰好重试一次（不无限重试）
    await app.close()
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
          : { status: '1', infocode: '10000', route: { paths: [{ distance: '820', duration: '660', steps: [{ instruction: '向北步行', distance: '120' }, { instruction: '到达目的地', distance: '0' }] }] } },
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
    // 全程距离/时长随响应返回（App 起步先播"全程约 820 米、约 11 分钟"），与逐步分开。
    expect(body.distanceMeters).toBe(820)
    expect(body.durationSeconds).toBe(660)
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

  it('/around 返回周边 POI（名/GCJ-02坐标/高德算的距离/分类），坏点剔除、距离非有限归 0', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        status: '1', infocode: '10000',
        pois: [
          { name: '全家便利店', location: '116.398,39.909', distance: '42', type: '购物服务;便民商店;便利店' }, // 三段各异：锁定取**末段**(便利店)，非首段(购物服务)、非中段(便民商店)
          { name: '', location: '116.4,39.9', distance: '10', type: 'x' },              // 空名 → 剔
          { name: '坏坐标', location: 'abc,def', distance: '5', type: 'y' },            // 非法坐标 → 剔
          { name: '距离坏了', location: '116.40,39.90', distance: 'NaN', type: '公厕' }, // 距离非有限 → 归 0
        ],
      }),
    })))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({
      method: 'GET',
      url: '/api/nav/around?lat=39.908&lon=116.397&radius=250',
      headers: { authorization: `Bearer ${t}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.radius).toBe(250)
    expect(body.pois).toEqual([
      { name: '全家便利店', lat: 39.909, lon: 116.398, distanceMeters: 42, category: '便利店' },
      { name: '距离坏了', lat: 39.9, lon: 116.4, distanceMeters: 0, category: '公厕' }, // NaN 距离 → 0，绝不外发 NaN
    ])
    await app.close()
  })

  it('/around?keywords= 定向检索：关键词转发到高德（"最近的X"用），并回显 radius', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true, status: 200,
      json: async () => ({ status: '1', infocode: '10000', pois: [{ name: '同仁堂药店', location: '116.4,39.9', distance: '88', type: '医疗保健;药店' }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({
      method: 'GET',
      url: '/api/nav/around?lat=39.9&lon=116.4&radius=1000&keywords=' + encodeURIComponent('药店'),
      headers: { authorization: `Bearer ${t}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().radius).toBe(1000)
    const calledUrl = String(fetchMock.mock.calls[0]?.[0] ?? '')
    expect(calledUrl).toContain('keywords=' + encodeURIComponent('药店')) // 关键词确实透传给高德
    expect(calledUrl).toContain('radius=1000')
    await app.close()
  })

  // 公交/地铁路径规划：三段响应（regeo 取城市 / geocode 目的地 / transit 方案），mock 按 URL 分派。
  const TRANSIT_OK = {
    status: '1', infocode: '10000',
    route: { transits: [ {
      duration: '1980', walking_distance: '350', nightflag: '0',
      segments: [
        { walking: { distance: '200', duration: '170' }, bus: { buslines: [] } }, // 步行段（bus 空占位）
        { walking: {}, bus: { buslines: [ {                                        // 地铁段（walking 空占位）
          name: '地铁1号线(苹果园--四惠东)', type: '地铁线路', via_num: '5',
          distance: '6000', duration: '900',
          departure_stop: { name: '西单站' }, arrival_stop: { name: '国贸站' },
        } ] } },
        { walking: { distance: '150', duration: '130' }, bus: { buslines: [] } },
      ],
    } ] },
  }
  const transitFetch = (transitBody: unknown) => vi.fn(async (url: string) =>
    ({ ok: true, status: 200, json: async () =>
      String(url).includes('/geocode/regeo') ? { status: '1', infocode: '10000', regeocode: { addressComponent: { adcode: '110000' } } }
      : String(url).includes('/geocode/geo') ? { status: '1', infocode: '10000', geocodes: [{ location: '116.45,39.92' }] }
      : String(url).includes('/direction/transit') ? transitBody
      : { status: '0', info: 'unexpected', infocode: '20000' } }))

  it('/transit 解析公交方案：步行→地铁→步行，空占位段不误当腿，字符串数值转安全数', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', transitFetch(TRANSIT_OK))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({
      method: 'GET',
      url: '/api/nav/transit?originLat=39.9&originLon=116.4&destination=' + encodeURIComponent('国贸'),
      headers: { authorization: `Bearer ${t}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.durationSeconds).toBe(1980)
    expect(body.walkingDistanceMeters).toBe(350)
    expect(body.legs).toEqual([
      { kind: 'walk', distanceMeters: 200, durationSeconds: 170 },
      { kind: 'subway', line: '地铁1号线', direction: '苹果园--四惠东', fromStop: '西单站', toStop: '国贸站', stops: 6, distanceMeters: 6000, durationSeconds: 900 },
      { kind: 'walk', distanceMeters: 150, durationSeconds: 130 },
    ])
    await app.close()
  })

  it('/transit 普通公交线路 → kind=bus，线路名去括注', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    const busPlan = { status: '1', infocode: '10000', route: { transits: [ { duration: '600', walking_distance: '100',
      segments: [ { walking: {}, bus: { buslines: [ { name: '300路(北京站东-马家堡)', type: '普通公交线路', via_num: '3',
        distance: '2000', duration: '480', departure_stop: { name: '甲站' }, arrival_stop: { name: '乙站' } } ] } } ] } ] } }
    vi.stubGlobal('fetch', transitFetch(busPlan))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({ method: 'GET', url: '/api/nav/transit?originLat=39.9&originLon=116.4&destLat=39.92&destLon=116.45', headers: { authorization: `Bearer ${t}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().legs[0]).toEqual({ kind: 'bus', line: '300路', direction: '北京站东-马家堡', fromStop: '甲站', toStop: '乙站', stops: 4, distanceMeters: 2000, durationSeconds: 480 })
    await app.close()
  })

  it('/transit 缺 via_num 不臆造站数（复审#2：否则"坐1站"让盲人第一站就下车）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    const plan = { status: '1', infocode: '10000', route: { transits: [ { duration: '1200', walking_distance: '0',
      segments: [ { walking: {}, bus: { buslines: [ { name: '快线2号(甲-乙)', type: '普通公交线路', // 无 via_num
        distance: '8000', duration: '1200', departure_stop: { name: '甲' }, arrival_stop: { name: '乙' } } ] } } ] } ] } }
    vi.stubGlobal('fetch', transitFetch(plan))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({ method: 'GET', url: '/api/nav/transit?originLat=39.9&originLon=116.4&destLat=39.92&destLon=116.45', headers: { authorization: `Bearer ${t}` } })
    expect(res.statusCode).toBe(200)
    const leg = res.json().legs[0]
    expect(leg.kind).toBe('bus')
    expect(leg).not.toHaveProperty('stops') // 缺 via_num → 不带 stops，绝不臆造"坐1站"
    await app.close()
  })

  it('/transit 以"号线"结尾的普通公交不误当地铁（复审#3：type 权威，"旅游1号线"是公交）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    const plan = { status: '1', infocode: '10000', route: { transits: [ { duration: '600', walking_distance: '0',
      segments: [ { walking: {}, bus: { buslines: [ { name: '旅游1号线', type: '普通公交线路', via_num: '4',
        distance: '3000', duration: '600', departure_stop: { name: '甲' }, arrival_stop: { name: '乙' } } ] } } ] } ] } }
    vi.stubGlobal('fetch', transitFetch(plan))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({ method: 'GET', url: '/api/nav/transit?originLat=39.9&originLon=116.4&destLat=39.92&destLon=116.45', headers: { authorization: `Bearer ${t}` } })
    expect(res.json().legs[0]).toMatchObject({ kind: 'bus', line: '旅游1号线', stops: 5 })
    await app.close()
  })

  it('/transit 解析火车/城际腿（railway 分支：车次名 + 起终站）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    const plan = { status: '1', infocode: '10000', route: { transits: [ { duration: '3600', walking_distance: '200',
      segments: [
        { walking: { distance: '200', duration: '170' }, bus: { buslines: [] } },
        { walking: {}, bus: { buslines: [] }, railway: { trip: 'G123', name: '城际', distance: '80000', time: '2400',
          departure_stop: { name: '北京南' }, arrival_stop: { name: '天津' } } },
      ] } ] } }
    vi.stubGlobal('fetch', transitFetch(plan))
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    const res = await app.inject({ method: 'GET', url: '/api/nav/transit?originLat=39.9&originLon=116.4&destLat=39.92&destLon=116.45', headers: { authorization: `Bearer ${t}` } })
    expect(res.json().legs).toEqual([
      { kind: 'walk', distanceMeters: 200, durationSeconds: 170 },
      { kind: 'railway', line: 'G123', fromStop: '北京南', toStop: '天津', distanceMeters: 80000, durationSeconds: 2400 },
    ])
    await app.close()
  })

  it('/transit 无公交方案（transits 空）→ 404 no_transit_route；目的地查不到 → 404 destination_not_found', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', transitFetch({ status: '1', infocode: '10000', route: { transits: [] } }))
    let app = buildApp(new MemoryStore())
    let t = await token(app)
    let res = await app.inject({ method: 'GET', url: '/api/nav/transit?originLat=39.9&originLon=116.4&destLat=39.92&destLon=116.45', headers: { authorization: `Bearer ${t}` } })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: 'no_transit_route' })
    await app.close()
    // 目的地名 geocode 空
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () =>
      String(url).includes('/geocode/regeo') ? { status: '1', infocode: '10000', regeocode: { addressComponent: { adcode: '110000' } } }
      : { status: '1', infocode: '10000', geocodes: [] } })))
    app = buildApp(new MemoryStore())
    t = await token(app)
    res = await app.inject({ method: 'GET', url: '/api/nav/transit?originLat=39.9&originLon=116.4&destination=' + encodeURIComponent('不存在xyz'), headers: { authorization: `Bearer ${t}` } })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: 'destination_not_found' })
    await app.close()
  })

  it('/transit AMap key 平台不符 → 502 amap_error；未配 → 503', async () => {
    process.env.AMAP_API_KEY = 'ios_sdk_key'
    vi.stubGlobal('fetch', transitFetch({ status: '0', info: 'USERKEY_PLAT_NOMATCH', infocode: '10009' }))
    let app = buildApp(new MemoryStore())
    let t = await token(app)
    let res = await app.inject({ method: 'GET', url: '/api/nav/transit?originLat=39.9&originLon=116.4&destLat=39.92&destLon=116.45', headers: { authorization: `Bearer ${t}` } })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({ error: 'amap_error', infocode: '10009' })
    await app.close()
    delete process.env.AMAP_API_KEY
    app = buildApp(new MemoryStore())
    t = await token(app)
    res = await app.inject({ method: 'GET', url: '/api/nav/transit?originLat=39.9&originLon=116.4&destLat=39.92&destLon=116.45', headers: { authorization: `Bearer ${t}` } })
    expect(res.statusCode).toBe(503)
    await app.close()
  })

  it('/around：AMap key 平台不符 → 502 amap_error（不静默当"周围什么都没有"）；坐标非法 → 400；未配 → 503', async () => {
    // 未配置
    delete process.env.AMAP_API_KEY
    let app = buildApp(new MemoryStore())
    let t = await token(app)
    let res = await app.inject({ method: 'GET', url: '/api/nav/around?lat=39.9&lon=116.4', headers: { authorization: `Bearer ${t}` } })
    expect(res.statusCode).toBe(503)
    await app.close()
    // 坐标非法
    process.env.AMAP_API_KEY = 'webkey'
    app = buildApp(new MemoryStore())
    t = await token(app)
    res = await app.inject({ method: 'GET', url: '/api/nav/around?lat=999&lon=116.4', headers: { authorization: `Bearer ${t}` } })
    expect(res.statusCode).toBe(400)
    await app.close()
    // key 平台不符
    process.env.AMAP_API_KEY = 'ios_sdk_key'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: '0', info: 'USERKEY_PLAT_NOMATCH', infocode: '10009' }) })))
    app = buildApp(new MemoryStore())
    t = await token(app)
    res = await app.inject({ method: 'GET', url: '/api/nav/around?lat=39.9&lon=116.4', headers: { authorization: `Bearer ${t}` } })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({ error: 'amap_error', infocode: '10009' })
    await app.close()
  })
})
