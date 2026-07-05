import { describe, it, expect } from 'vitest'
import { batteryBadge } from './battery'

describe('batteryBadge（联系人位置卡电量徽标）', () => {
  it('正常电量显示百分比；≤20% danger；≤10% critical（两级，与服务端预警一致）', () => {
    expect(batteryBadge(85, 'zh')).toEqual({ text: '电量 85%', danger: false, critical: false })
    expect(batteryBadge(21, 'en')).toEqual({ text: 'Battery 21%', danger: false, critical: false })
    // danger 区间（10<pct≤20）：红但非 critical。
    expect(batteryBadge(20, 'zh')).toEqual({ text: '电量 20%', danger: true, critical: false })  // 边界 20 含 danger
    expect(batteryBadge(11, 'zh')).toEqual({ text: '电量 11%', danger: true, critical: false })  // 11 仍非 critical
    // critical 区间（≤10）：即将关机，danger 与 critical 皆真。
    expect(batteryBadge(10, 'zh')).toEqual({ text: '电量 10%', danger: true, critical: true })   // 边界 10 含 critical
    expect(batteryBadge(5, 'en')).toEqual({ text: 'Battery 5%', danger: true, critical: true })
  })

  it('无数据/非法值 → null（老客户端不上报：不显示、不猜）', () => {
    expect(batteryBadge(null, 'zh')).toBeNull()
    expect(batteryBadge(undefined, 'zh')).toBeNull()
    expect(batteryBadge(-1, 'zh')).toBeNull()
    expect(batteryBadge(150, 'zh')).toBeNull()
    expect(batteryBadge(Number.NaN, 'zh')).toBeNull()
  })
})
