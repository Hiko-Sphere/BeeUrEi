import { describe, it, expect } from 'vitest'
import { composeContactAddress } from './contactAddress'
import type { ContactAddress } from './api'

const zh = (z: string) => z
const en = (_z: string, e: string) => e

// 便捷构造：只填关心的字段。
function addr(o: Partial<ContactAddress>): ContactAddress {
  return { address: '', township: '', ...o }
}

describe('composeContactAddress（联系人所在地：AOI ≤300m 距离门 + 路口/地标）', () => {
  it('地址优先；近 AOI（50m）附"（在X一带）"', () => {
    expect(composeContactAddress(addr({ address: '景华南街5号', aoi: { name: '华贸中心', distanceMeters: 50 } }), zh))
      .toBe('景华南街5号（在华贸中心一带）')
  })
  it('恰好 300m → 仍附（临界）', () => {
    expect(composeContactAddress(addr({ address: '景华南街5号', aoi: { name: '华贸中心', distanceMeters: 300 } }), zh))
      .toContain('华贸中心')
  })
  it('远 AOI（500m）→ **不附**（绝不谎称在远处 AOI 一带），只报基址', () => {
    expect(composeContactAddress(addr({ address: '景华南街5号', aoi: { name: '华贸中心', distanceMeters: 500 } }), zh))
      .toBe('景华南街5号')
  })
  it('非有限距离（坏数据）→ 不附', () => {
    expect(composeContactAddress(addr({ address: '景华南街5号', aoi: { name: '华贸中心', distanceMeters: NaN } }), zh))
      .toBe('景华南街5号')
  })
  it('距离缺失（旧数据）→ 仍附（向后兼容，不因缺距离丢 AOI）', () => {
    const r = addr({ address: '景华南街5号', aoi: { name: '华贸中心' } as ContactAddress['aoi'] })
    expect(composeContactAddress(r, zh)).toBe('景华南街5号（在华贸中心一带）')
  })
  it('address 空 → 退回 township；无 AOI → 只报基址', () => {
    expect(composeContactAddress(addr({ township: '望京街道' }), zh)).toBe('望京街道')
  })
  it('address 与 township 皆空 → null（无地址不硬凑半句）', () => {
    expect(composeContactAddress(addr({ aoi: { name: '某AOI', distanceMeters: 10 } }), zh)).toBeNull()
  })
  it('AOI 名已含在基址里 → 不重复附', () => {
    expect(composeContactAddress(addr({ address: '华贸中心南门', aoi: { name: '华贸中心', distanceMeters: 10 } }), zh))
      .toBe('华贸中心南门')
  })
  it('最近路口（两条不同路名）附在后；同名两路不成交叉口→跳过', () => {
    expect(composeContactAddress(addr({ address: '建国路88号', intersection: { firstRoad: '建国路', secondRoad: '东三环', direction: '', distanceMeters: 20 } }), zh))
      .toBe('建国路88号，附近路口建国路与东三环交叉口')
    expect(composeContactAddress(addr({ address: '建国路88号', intersection: { firstRoad: '建国路', secondRoad: '建国路', direction: '', distanceMeters: 20 } }), zh))
      .toBe('建国路88号')
  })
  it('最近地标附在后；名已现→跳过防赘述', () => {
    expect(composeContactAddress(addr({ address: '人民路5号', landmark: { name: '国贸大厦', direction: '', distanceMeters: 30 } }), zh))
      .toBe('人民路5号，最近地标国贸大厦')
  })
  it('英文分支不串中文（远 AOI 被过滤后英文亦不含 near）', () => {
    const s = composeContactAddress(addr({ address: '5 Jinghua St', aoi: { name: 'Guomao', distanceMeters: 500 }, landmark: { name: 'CBD Tower', direction: '', distanceMeters: 30 } }), en)!
    expect(s).toBe('5 Jinghua St, nearest landmark CBD Tower')
    expect(s).not.toContain('Guomao') // 远 AOI 被距离门过滤，绝不出现（"nearest landmark" 里的 near 是地标句、合法）
    expect(s).not.toMatch(/[一-鿿]/)
  })
})
