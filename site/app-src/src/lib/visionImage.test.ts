import { describe, it, expect } from 'vitest'
import { fittedSize, downscaleForVision, MAX_LONG_SIDE } from './visionImage'

describe('fittedSize（送 AI 描述前降采样尺寸，长边 ≤1024、绝不放大）', () => {
  it('长边超上限 → 等比缩到 1024', () => {
    expect(fittedSize(2048, 1024)).toEqual({ width: 1024, height: 512 })   // 4096→ no; 2048 长边 → 半
    expect(fittedSize(4000, 3000)).toEqual({ width: 1024, height: 768 })   // 4:3 → 1024×768
    expect(fittedSize(1000, 3000)).toEqual({ width: 341, height: 1024 })   // 竖图长边=高
  })
  it('未超上限 → 原样不放大', () => {
    expect(fittedSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fittedSize(1024, 1024)).toEqual({ width: 1024, height: 1024 })  // 恰上限不缩
    expect(fittedSize(300, 200)).toEqual({ width: 300, height: 200 })
  })
  it('坏尺寸（0/非有限）兜底不产生 NaN', () => {
    expect(fittedSize(0, 500)).toEqual({ width: 1, height: 500 })
    expect(fittedSize(NaN, 500).width).toBeGreaterThanOrEqual(1)
    expect(Number.isNaN(fittedSize(NaN, 500).width)).toBe(false)
  })
  it('MAX_LONG_SIDE 与 iOS 同为 1024', () => {
    expect(MAX_LONG_SIDE).toBe(1024)
  })
})

describe('downscaleForVision 回退（无 DOM / 加载失败时不阻断描述）', () => {
  it('非浏览器环境（无 document）→ 原样返回 + 从 data URL 解析 mime', async () => {
    const jpeg = await downscaleForVision('data:image/jpeg;base64,AAAA')
    expect(jpeg).toEqual({ dataUrl: 'data:image/jpeg;base64,AAAA', mime: 'image/jpeg' })
    const png = await downscaleForVision('data:image/png;base64,AAAA')
    expect(png.mime).toBe('image/png')
    const webp = await downscaleForVision('data:image/webp;base64,AAAA')
    expect(webp.mime).toBe('image/webp')
  })
  it('无法解析格式 → 回退 image/jpeg（不崩、不阻断）', async () => {
    const r = await downscaleForVision('not-a-data-url')
    expect(r.mime).toBe('image/jpeg')
    expect(r.dataUrl).toBe('not-a-data-url')
  })
})
