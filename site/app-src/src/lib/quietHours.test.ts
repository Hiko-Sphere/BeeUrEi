import { describe, it, expect } from 'vitest'
import { inQuietHoursNow } from './quietHours'

// 本机时钟判定：new Date(y,mo,d,H,M) 的 getHours/getMinutes 取本地时分（与生产同口径）。
const at = (h: number, m = 0) => new Date(2026, 0, 5, h, m)

describe('inQuietHoursNow 当前是否勿扰（与服务端抑制判定同口径）', () => {
  it('跨午夜窗口 22:00–07:00：夜间在内、白天在外（[start,24h) ∪ [0,end)）', () => {
    const s = 22 * 60, e = 7 * 60
    expect(inQuietHoursNow(s, e, at(23, 0))).toBe(true)  // 23:00 在内
    expect(inQuietHoursNow(s, e, at(3, 0))).toBe(true)   // 凌晨 3 点在内
    expect(inQuietHoursNow(s, e, at(6, 59))).toBe(true)  // 06:59 仍在内
    expect(inQuietHoursNow(s, e, at(7, 0))).toBe(false)  // 07:00 结束（左闭右开）→ 出
    expect(inQuietHoursNow(s, e, at(12, 0))).toBe(false) // 正午在外
    expect(inQuietHoursNow(s, e, at(21, 59))).toBe(false)// 21:59 未到 → 外
    expect(inQuietHoursNow(s, e, at(22, 0))).toBe(true)  // 22:00 起（左闭）→ 入
  })

  it('同日窗口 09:00–17:00：窗口内在内、之外在外（[start,end)）', () => {
    const s = 9 * 60, e = 17 * 60
    expect(inQuietHoursNow(s, e, at(12, 0))).toBe(true)
    expect(inQuietHoursNow(s, e, at(9, 0))).toBe(true)   // 左闭
    expect(inQuietHoursNow(s, e, at(17, 0))).toBe(false) // 右开
    expect(inQuietHoursNow(s, e, at(8, 59))).toBe(false)
    expect(inQuietHoursNow(s, e, at(23, 0))).toBe(false)
  })

  it('start===end → 无有效窗口，恒 false（UI 也禁止二者相同）', () => {
    expect(inQuietHoursNow(600, 600, at(10, 0))).toBe(false)
  })
})
