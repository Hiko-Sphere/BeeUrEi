import { describe, it, expect } from 'vitest'
import { wgs84ToGcj02, gcj02ToWgs84, isInChina } from '../src/nav/chinaCoord'

describe('chinaCoord（与 iOS ChinaCoord 同算法）', () => {
  it('境内坐标 WGS-84→GCJ-02 偏移在 100–700m 量级（天安门附近）', () => {
    const g = wgs84ToGcj02(39.9042, 116.4074)
    // 偏移约几百米：纬经度差在 0.001–0.01 度之间
    expect(Math.abs(g.lat - 39.9042)).toBeGreaterThan(0.0005)
    expect(Math.abs(g.lon - 116.4074)).toBeGreaterThan(0.0005)
    expect(Math.abs(g.lat - 39.9042)).toBeLessThan(0.01)
    expect(Math.abs(g.lon - 116.4074)).toBeLessThan(0.01)
  })

  it('往返 WGS→GCJ→WGS 误差 < ~1e-5 度（约米级，迭代逆变换）', () => {
    for (const [lat, lon] of [[39.9042, 116.4074], [31.2304, 121.4737], [22.5431, 114.0579]]) {
      const g = wgs84ToGcj02(lat, lon)
      const w = gcj02ToWgs84(g.lat, g.lon)
      expect(Math.abs(w.lat - lat)).toBeLessThan(1e-5)
      expect(Math.abs(w.lon - lon)).toBeLessThan(1e-5)
    }
  })

  it('境外坐标原样返回（不偏移）', () => {
    expect(isInChina(40.7128, -74.006)).toBe(false) // 纽约
    expect(wgs84ToGcj02(40.7128, -74.006)).toEqual({ lat: 40.7128, lon: -74.006 })
    expect(gcj02ToWgs84(40.7128, -74.006)).toEqual({ lat: 40.7128, lon: -74.006 })
  })
})
