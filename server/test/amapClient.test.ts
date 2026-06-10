import { describe, it, expect, afterEach, vi } from 'vitest'
import { amapWalking, amapGeocode, amapConfigured } from '../src/nav/amapClient'

/// 高德客户端单测：聚焦折线解析（跳过非法点、distance 非数字兜底为 0，绝不外发 NaN）与未配置兜底。
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
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      json: async () =>
        url.includes('geocode')
          ? { geocodes: [{ location: '116.397,39.908' }] }
          : {
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
            },
    })))
    expect(await amapGeocode('天安门')).toBe('116.397,39.908')
    const steps = await amapWalking('116.40,39.90', '116.42,39.91')
    expect(steps.length).toBe(2)
    expect(steps[0]).toMatchObject({ instruction: '向北', distanceMeters: 100 })
    expect(steps[0].polyline).toEqual([[39.90, 116.40], [39.91, 116.42]])
    expect(steps[1]).toMatchObject({ instruction: '到达', distanceMeters: 0, polyline: [] })
  })

  it('geocode 无结果 → undefined；walking 无 paths → []', async () => {
    process.env.AMAP_API_KEY = 'testkey'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      json: async () => (url.includes('geocode') ? { geocodes: [] } : { route: { paths: [] } }),
    })))
    expect(await amapGeocode('x')).toBeUndefined()
    expect(await amapWalking('116.4,39.9', '116.5,39.9')).toEqual([])
  })
})
