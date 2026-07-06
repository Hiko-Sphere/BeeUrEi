import { describe, it, expect } from 'vitest'
import { batteryBadge, batteryPercent } from './battery'

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

describe('batteryPercent（Battery Status API level 0..1 → 整数百分比上报）', () => {
  it('level 0..1 → 四舍五入整数百分比', () => {
    expect(batteryPercent(0.85)).toBe(85)
    expect(batteryPercent(1)).toBe(100)
    expect(batteryPercent(0)).toBe(0)      // 0% 是合法上报值（非"无数据"）
    expect(batteryPercent(0.055)).toBe(6)  // 四舍五入
    expect(batteryPercent(0.054)).toBe(5)
  })
  it('无效值 → undefined（不上报，服务端按缺省；联系人端不显示假电量）', () => {
    expect(batteryPercent(null)).toBeUndefined()
    expect(batteryPercent(undefined)).toBeUndefined()
    expect(batteryPercent(Number.NaN)).toBeUndefined()
    expect(batteryPercent(Infinity)).toBeUndefined()
  })
  it('越界一律夹取到 [0,100]（防某些实现返回 >1/负值时上报出界被服务端 400 拒）', () => {
    expect(batteryPercent(1.2)).toBe(100)
    expect(batteryPercent(-0.1)).toBe(0)
  })
})
