import { describe, it, expect, afterEach, vi } from 'vitest'
import { amapWalking, amapGeocode, amapConfigured, AmapError, amapTransit } from '../src/nav/amapClient'

/// 高德客户端单测：折线解析（跳过非法点、distance 非数字兜底为 0，绝不外发 NaN）、未配置兜底，
/// 以及**响应状态校验**（key 平台不符等错误抛 AmapError，不静默退化成"目的地未找到"）。
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data })

describe('amapClient（国内步行导航）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.AMAP_API_KEY
  })

  it('未配置 key：amapConfigured=false，geocode/walking 返回空', async () => {
    delete process.env.AMAP_API_KEY
    expect(amapConfigured()).toBe(false)
    expect(await amapGeocode('天安门')).toBeUndefined()
    expect(await amapWalking('116.4,39.9', '116.39,39.90')).toEqual({ steps: [], distanceMeters: 0, durationSeconds: 0 })
  })

  it('解析步骤+折线：跳过越界/非数字点，distance 非数字兜底为 0', async () => {
    process.env.AMAP_API_KEY = 'testkey'
    expect(amapConfigured()).toBe(true)
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      ok(url.includes('geocode')
        ? { status: '1', infocode: '10000', geocodes: [{ location: '116.397,39.908' }] }
        : {
            status: '1', infocode: '10000',
            route: {
              paths: [
                {
                  distance: '250.7', duration: '190', // 路线级全程：距离取整→251、时长→190（totals 取高德权威值）
                  steps: [
                    // 4 个原始点：含 1 个经度越界(999) + 1 个非数字(abc)，都应被跳过。
                    { instruction: '向北', distance: '100', polyline: '116.40,39.90;999,39.90;116.41,abc;116.42,39.91' },
                    // distance 非数字 → 0；空折线 → []。
                    { instruction: '到达', distance: 'NaNish', polyline: '' },
                  ],
                },
              ],
            },
          }),
    ))
    expect(await amapGeocode('天安门')).toBe('116.397,39.908')
    const route = await amapWalking('116.40,39.90', '116.42,39.91')
    expect(route.steps.length).toBe(2)
    expect(route.steps[0]).toMatchObject({ instruction: '向北', distanceMeters: 100 })
    expect(route.steps[0].polyline).toEqual([[39.90, 116.40], [39.91, 116.42]])
    expect(route.steps[1]).toMatchObject({ instruction: '到达', distanceMeters: 0, polyline: [] })
    // 全程距离/时长（高德路线级权威值）：距离取整，绝不外发 NaN/负。
    expect(route.distanceMeters).toBe(251)
    expect(route.durationSeconds).toBe(190)
  })

  it('geocode 无结果 → undefined；walking 无 paths → []（status=1 时为真实空结果）', async () => {
    process.env.AMAP_API_KEY = 'testkey'
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      ok(url.includes('geocode')
        ? { status: '1', infocode: '10000', geocodes: [] }
        : { status: '1', infocode: '10000', route: { paths: [] } }),
    ))
    expect(await amapGeocode('x')).toBeUndefined()
    expect(await amapWalking('116.4,39.9', '116.5,39.9')).toEqual({ steps: [], distanceMeters: 0, durationSeconds: 0 })
  })

  it('key 平台不符（USERKEY_PLAT_NOMATCH / infocode 10009）→ 抛 AmapError，不静默当成未找到', async () => {
    process.env.AMAP_API_KEY = 'ios_sdk_key'
    vi.stubGlobal('fetch', vi.fn(async () =>
      ok({ status: '0', info: 'USERKEY_PLAT_NOMATCH', infocode: '10009' }),
    ))
    await expect(amapGeocode('天安门')).rejects.toBeInstanceOf(AmapError)
    await expect(amapGeocode('天安门')).rejects.toMatchObject({ infocode: '10009', info: 'USERKEY_PLAT_NOMATCH' })
    await expect(amapWalking('116.4,39.9', '116.5,39.9')).rejects.toBeInstanceOf(AmapError)
  })

  it('公交方案：地铁段解出进/出站口（entrance/exit），公交段不携带站口', async () => {
    process.env.AMAP_API_KEY = 'testkey'
    // 高德 transit/integrated 响应：一段地铁（带 entrance/exit）+ 一段公交（无站口）。空对象/空名的兜底一并覆盖。
    vi.stubGlobal('fetch', vi.fn(async () => ok({
      status: '1', infocode: '10000',
      route: { transits: [{ duration: '1800', walking_distance: '200', segments: [
        {
          entrance: { name: 'A口' }, exit: { name: 'D口' },
          bus: { buslines: [{ name: '地铁1号线(苹果园-四惠东)', type: '地铁', via_num: '3',
                              distance: '5000', duration: '600',
                              departure_stop: { name: '人民广场' }, arrival_stop: { name: '徐家汇' } }] },
        },
        {
          // 公交段：即便高德给了 entrance 空对象，也不该落到 bus 腿上（公交无"站口"概念）。
          entrance: {}, exit: {},
          bus: { buslines: [{ name: '300路', type: '普通公交', via_num: '4',
                              distance: '3000', duration: '500',
                              departure_stop: { name: '甲站' }, arrival_stop: { name: '乙站' } }] },
        },
      ] }] },
    })))
    const plan = await amapTransit('116.4,39.9', '116.5,39.9', '021')
    expect(plan).not.toBeNull()
    const subway = plan!.legs.find((l) => l.kind === 'subway')!
    expect(subway.entrance).toBe('A口')
    expect(subway.exit).toBe('D口')
    expect(subway.line).toBe('地铁1号线') // 括注已去
    const bus = plan!.legs.find((l) => l.kind === 'bus')!
    expect(bus.entrance).toBeUndefined() // 公交段不携带站口（空对象/非地铁 → undefined）
    expect(bus.exit).toBeUndefined()
  })

  it('HTTP 非 2xx → 抛 AmapError（http_<status>）', async () => {
    process.env.AMAP_API_KEY = 'testkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })))
    await expect(amapGeocode('天安门')).rejects.toMatchObject({ infocode: 'http_403' })
  })
})
