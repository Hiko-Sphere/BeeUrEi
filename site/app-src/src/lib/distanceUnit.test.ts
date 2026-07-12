// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { farDistance, getUnit, setUnit } from './distanceUnit'

const zh = (a: string) => a
const en = (_a: string, b: string) => b

describe('farDistance（与 iOS DistanceUnit.farDistance 同口径）', () => {
  it('公制：<1km 整米、≥1km 公里(0.1 去尾零)', () => {
    expect(farDistance(20, 'metric', zh)).toBe('20 米')
    expect(farDistance(999, 'metric', zh)).toBe('999 米')
    expect(farDistance(1500, 'metric', zh)).toBe('1.5 公里')
    expect(farDistance(2000, 'metric', zh)).toBe('2 公里')   // 去尾零 2.0→2
    expect(farDistance(1500, 'metric', en)).toBe('1.5 km')
  })
  it('英制：<1000ft 整英尺、≥1000ft 英里(0.1)', () => {
    expect(farDistance(20, 'imperial', zh)).toBe('66 英尺')   // 20/0.3048≈65.6→66
    expect(farDistance(20, 'imperial', en)).toBe('66 ft')
    expect(farDistance(1500, 'imperial', en)).toBe('0.9 mi')  // 1500m≈0.93mi→0.9
    expect(farDistance(3000, 'imperial', en)).toBe('1.9 mi')  // 3000m≈1.86mi→1.9
    expect(farDistance(300, 'imperial', zh)).toBe('984 英尺')  // 仍 <1000ft
  })
  it('非有限/≤0 归 0；有限巨值夹 1e6，绝不 NaN', () => {
    expect(farDistance(NaN, 'imperial', en)).toBe('0 ft')
    expect(farDistance(-5, 'metric', zh)).toBe('0 米')
    expect(farDistance(Infinity, 'metric', en)).toBe('0 m')      // 非有限→0（绝不臆造巨值）
    expect(farDistance(1e19, 'metric', en)).toBe('1000 km')      // 有限巨值夹 1e6 米=1000km
  })
})

describe('getUnit/setUnit（localStorage 持久化，默认公制）', () => {
  beforeEach(() => localStorage.clear())
  it('默认公制；setUnit 后读回', () => {
    expect(getUnit()).toBe('metric')
    setUnit('imperial')
    expect(getUnit()).toBe('imperial')
    setUnit('metric')
    expect(getUnit()).toBe('metric')
  })
})
