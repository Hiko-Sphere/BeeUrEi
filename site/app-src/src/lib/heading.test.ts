import { describe, it, expect } from 'vitest'
import { cardinal, headingPhrase, trustworthyHeading, MIN_HEADING_SPEED_MPS } from './heading'

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

describe('trustworthyHeading（上报前按 speed 门控行进方向，与 iOS CourseFilter 同原则）', () => {
  it('heading 有效 + 速度足够 → 归一化返回', () => {
    expect(trustworthyHeading(90, 3)).toBe(90)
    expect(trustworthyHeading(0, 0.5)).toBe(0)      // 恰在阈值上（不 < 0.5）
    expect(trustworthyHeading(359, 10)).toBe(359)
  })
  it('近静止（speed < 0.5 m/s）→ null（关键改进：低速 heading 是噪声，旧代码会误发）', () => {
    expect(trustworthyHeading(90, 0)).toBeNull()
    expect(trustworthyHeading(90, 0.3)).toBeNull()
    expect(trustworthyHeading(90, MIN_HEADING_SPEED_MPS - 0.01)).toBeNull()
  })
  it('heading 无效（null/NaN/Infinity）→ null，无论速度', () => {
    expect(trustworthyHeading(null, 5)).toBeNull()
    expect(trustworthyHeading(undefined, 5)).toBeNull()
    expect(trustworthyHeading(NaN, 5)).toBeNull()
    expect(trustworthyHeading(Infinity, 5)).toBeNull()
  })
  it('speed 缺失/非有限（浏览器不报）→ 退化为仅按 heading 有效（不误伤、不改旧行为）', () => {
    expect(trustworthyHeading(135, null)).toBe(135)
    expect(trustworthyHeading(135, undefined)).toBe(135)
    expect(trustworthyHeading(135, NaN)).toBe(135)
  })
  it('归一到 [0,360)：负数/超 360 等价角同结果', () => {
    expect(trustworthyHeading(-90, 5)).toBe(270)
    expect(trustworthyHeading(360, 5)).toBe(0)
    expect(trustworthyHeading(450, 5)).toBe(90)
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
