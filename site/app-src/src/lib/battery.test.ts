import { describe, it, expect } from 'vitest'
import { batteryBadge } from './battery'

describe('batteryBadge（联系人位置卡电量徽标）', () => {
  it('正常电量显示百分比；≤20% 标 danger（失联前主动联系）', () => {
    expect(batteryBadge(85, 'zh')).toEqual({ text: '电量 85%', danger: false })
    expect(batteryBadge(20, 'zh')).toEqual({ text: '电量 20%', danger: true })  // 边界 20 含
    expect(batteryBadge(5, 'en')).toEqual({ text: 'Battery 5%', danger: true })
    expect(batteryBadge(21, 'en')).toEqual({ text: 'Battery 21%', danger: false })
  })

  it('无数据/非法值 → null（老客户端不上报：不显示、不猜）', () => {
    expect(batteryBadge(null, 'zh')).toBeNull()
    expect(batteryBadge(undefined, 'zh')).toBeNull()
    expect(batteryBadge(-1, 'zh')).toBeNull()
    expect(batteryBadge(150, 'zh')).toBeNull()
    expect(batteryBadge(Number.NaN, 'zh')).toBeNull()
  })
})
