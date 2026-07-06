import { describe, it, expect } from 'vitest'
import { cardinal, headingPhrase } from './heading'

describe('cardinal（方位角→八方位，与 iOS CompassRose 同口径）', () => {
  it('正方位落在各自扇区中心', () => {
    expect(cardinal(0, 'zh')).toBe('正北')
    expect(cardinal(45, 'zh')).toBe('东北')
    expect(cardinal(90, 'zh')).toBe('正东')
    expect(cardinal(135, 'zh')).toBe('东南')
    expect(cardinal(180, 'zh')).toBe('正南')
    expect(cardinal(225, 'zh')).toBe('西南')
    expect(cardinal(270, 'zh')).toBe('正西')
    expect(cardinal(315, 'zh')).toBe('西北')
  })
  it('扇区边界 [337.5,22.5)→正北（+22.5 偏移使正方位居中）', () => {
    expect(cardinal(350, 'zh')).toBe('正北')
    expect(cardinal(10, 'zh')).toBe('正北')
    expect(cardinal(22, 'zh')).toBe('正北')
    expect(cardinal(23, 'zh')).toBe('东北') // 越过 22.5 进东北扇区
    expect(cardinal(337, 'zh')).toBe('西北')
    expect(cardinal(338, 'zh')).toBe('正北') // 越过 337.5 回正北扇区
  })
  it('归一化：负数/超 360 与其等价角同结果', () => {
    expect(cardinal(-90, 'zh')).toBe(cardinal(270, 'zh'))
    expect(cardinal(360, 'zh')).toBe('正北')
    expect(cardinal(450, 'zh')).toBe('正东') // 450≡90
  })
  it('英文名与 iOS 一致', () => {
    expect(cardinal(0, 'en')).toBe('north')
    expect(cardinal(45, 'en')).toBe('north-east')
    expect(cardinal(315, 'en')).toBe('north-west')
  })
  it('非有限/缺省 → null（绝不瞎报方向）', () => {
    expect(cardinal(NaN, 'zh')).toBeNull()
    expect(cardinal(Infinity, 'zh')).toBeNull()
    expect(cardinal(null, 'zh')).toBeNull()
    expect(cardinal(undefined, 'zh')).toBeNull()
  })
})

describe('headingPhrase（行进方向短语）', () => {
  it('有效 heading → 双语短语', () => {
    expect(headingPhrase(45, 'zh')).toBe('正朝东北方向移动')
    expect(headingPhrase(45, 'en')).toBe('moving north-east')
  })
  it('静止/不可用（NaN/null）→ null（不展示）', () => {
    expect(headingPhrase(NaN, 'zh')).toBeNull()
    expect(headingPhrase(null, 'en')).toBeNull()
  })
})
