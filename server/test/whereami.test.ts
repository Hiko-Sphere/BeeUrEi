import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

async function token(app: ReturnType<typeof buildApp>) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'whoami', password: 'secret123' } })
  return r.json().token as string
}
const get = (app: ReturnType<typeof buildApp>, t: string, qs = 'lat=39.9&lon=116.4') =>
  app.inject({ method: 'GET', url: `/api/nav/whereami?${qs}`, headers: { authorization: `Bearer ${t}` } })

describe('AMap reverse-geocode「我在哪」proxy', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.AMAP_API_KEY })

  it('成功：返回格式化地址 + 街道 + 最近地标（按最小距离挑，非返回序）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
      status: '1', infocode: '10000',
      regeocode: {
        formatted_address: '北京市朝阳区呼家楼街道景华南街5号',
        addressComponent: { township: '呼家楼街道' },
        pois: [
          { name: '远地标', direction: '西', distance: '180' },
          { name: '银泰中心', direction: '东', distance: '50' }, // 最近 → 应被选中
          { name: '中地标', direction: '南', distance: '120' },
        ],
      },
    }) })))
    const app = buildApp(new MemoryStore())
    const res = await get(app, await token(app))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      address: '北京市朝阳区呼家楼街道景华南街5号',
      township: '呼家楼街道',
      landmark: { name: '银泰中心', direction: '东', distanceMeters: 50 },
    })
    await app.close()
  })

  it('最近路口（roadinters）：按最小距离挑有效项，随地标一并返回（Soundscape 式路口锚点）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
      status: '1', infocode: '10000',
      regeocode: {
        formatted_address: '北京市朝阳区',
        addressComponent: { township: '望京街道' },
        pois: [{ name: '银泰', direction: '东', distance: '50' }],
        roadinters: [
          { first_name: '阜通东大街', second_name: '望京中环南路', direction: '东北', distance: '120' }, // 远
          { first_name: '广顺北大街', second_name: '阜通西大街', direction: '西', distance: '40' },       // 最近 → 选中
          { first_name: '无名交叉', second_name: [], direction: '南', distance: '10' },                   // 缺第二路名 → 剔（即便更近）
          { first_name: '空距离口', second_name: '某路', direction: '北', distance: [] },                 // 空距离陷阱 → 剔
        ],
      },
    }) })))
    const app = buildApp(new MemoryStore())
    const res = await get(app, await token(app))
    expect(res.statusCode).toBe(200)
    expect(res.json().intersection).toEqual({ firstRoad: '广顺北大街', secondRoad: '阜通西大街', direction: '西', distanceMeters: 40 })
    await app.close()
  })

  it('无 roadinters / 全无效：intersection 字段省略（不外发空/坏路口）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
      status: '1', infocode: '10000',
      regeocode: {
        formatted_address: '某地', addressComponent: { township: '某街道' }, pois: [],
        roadinters: [{ first_name: '只有一条路', second_name: [], direction: '东', distance: '20' }], // 缺路名 → 无有效交叉口
      },
    }) })))
    const app = buildApp(new MemoryStore())
    const res = await get(app, await token(app))
    expect(res.statusCode).toBe(200)
    expect(res.json().intersection).toBeUndefined()
    await app.close()
  })

  it('高德坑：空字段返回空数组 [] 不崩、归一为空串；坏 POI（无名/负距离）剔除', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
      status: '1', infocode: '10000',
      regeocode: {
        formatted_address: [], // amap regeo 特有：空字段是 []，不是 ''
        addressComponent: { township: '幸福街道' },
        pois: [
          { name: [], direction: '东', distance: '10' },     // 无名 → 剔
          { name: '合法店', direction: '北', distance: '-5' },  // 负距离 → 剔
          { name: '空距离店', direction: '西', distance: [] },  // 空距离 []（Number('')===0 陷阱）→ 剔，绝不伪装成"0米"抢占最近地标
          { name: '真地标', direction: '南', distance: '60' },
        ],
      },
    }) })))
    const app = buildApp(new MemoryStore())
    const res = await get(app, await token(app))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      address: '', township: '幸福街道',
      landmark: { name: '真地标', direction: '南', distanceMeters: 60 },
    })
    await app.close()
  })

  it('真正 0 米的地标（字符串 "0"）照常保留——修复空距离陷阱不误伤真零', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
      status: '1', infocode: '10000',
      regeocode: {
        formatted_address: '某地',
        addressComponent: { township: '某街道' },
        pois: [{ name: '脚下的店', direction: '本', distance: '0' }],
      },
    }) })))
    const app = buildApp(new MemoryStore())
    const res = await get(app, await token(app))
    expect(res.statusCode).toBe(200)
    expect(res.json().landmark).toEqual({ name: '脚下的店', direction: '本', distanceMeters: 0 })
    await app.close()
  })

  it('地址+街道+POI 全空 → 404 address_not_found（上层回退 Apple）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
      status: '1', infocode: '10000',
      regeocode: { formatted_address: [], addressComponent: { township: [] }, pois: [] },
    }) })))
    const app = buildApp(new MemoryStore())
    const res = await get(app, await token(app))
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: 'address_not_found' })
    await app.close()
  })

  it('未配 AMAP key → 503', async () => {
    delete process.env.AMAP_API_KEY
    const app = buildApp(new MemoryStore())
    const res = await get(app, await token(app))
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ error: 'amap_not_configured' })
    await app.close()
  })

  it('高德上游错误（key 平台不符 status!=1）→ 502 amap_error 带 infocode（不误当"查不到"）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ status: '0', info: 'USERKEY_PLAT_NOMATCH', infocode: '10009' }) })))
    const app = buildApp(new MemoryStore())
    const res = await get(app, await token(app))
    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({ error: 'amap_error', infocode: '10009' })
    await app.close()
  })

  it('坐标非法（空/超范围）→ 400，且未登录 → 401', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    const app = buildApp(new MemoryStore())
    const t = await token(app)
    expect((await get(app, t, 'lat=&lon=116.4')).statusCode).toBe(400)       // 空串不静默当 0
    expect((await get(app, t, 'lat=99&lon=116.4')).statusCode).toBe(400)      // 纬度超范围
    expect((await app.inject({ method: 'GET', url: '/api/nav/whereami?lat=39.9&lon=116.4' })).statusCode).toBe(401) // 无鉴权
    await app.close()
  })
})
