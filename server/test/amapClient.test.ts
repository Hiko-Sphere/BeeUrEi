import { describe, it, expect, afterEach, vi } from 'vitest'
import { amapWalking, amapGeocode, amapConfigured, AmapError } from '../src/nav/amapClient'

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
    expect(await amapWalking('116.4,39.9', '116.39,39.90')).toEqual([])
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
    const steps = await amapWalking('116.40,39.90', '116.42,39.91')
    expect(steps.length).toBe(2)
    expect(steps[0]).toMatchObject({ instruction: '向北', distanceMeters: 100 })
    expect(steps[0].polyline).toEqual([[39.90, 116.40], [39.91, 116.42]])
    expect(steps[1]).toMatchObject({ instruction: '到达', distanceMeters: 0, polyline: [] })
  })

  it('geocode 无结果 → undefined；walking 无 paths → []（status=1 时为真实空结果）', async () => {
    process.env.AMAP_API_KEY = 'testkey'
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      ok(url.includes('geocode')
        ? { status: '1', infocode: '10000', geocodes: [] }
        : { status: '1', infocode: '10000', route: { paths: [] } }),
    ))
    expect(await amapGeocode('x')).toBeUndefined()
    expect(await amapWalking('116.4,39.9', '116.5,39.9')).toEqual([])
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

  it('HTTP 非 2xx → 抛 AmapError（http_<status>）', async () => {
    process.env.AMAP_API_KEY = 'testkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })))
    await expect(amapGeocode('天安门')).rejects.toMatchObject({ infocode: 'http_403' })
  })
})
