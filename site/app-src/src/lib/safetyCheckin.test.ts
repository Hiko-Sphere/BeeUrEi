import { describe, it, expect } from 'vitest'
import { remainingText, durationName } from './safetyCheckin'

describe('safety check-in 剩余时间/时长格式（与 iOS SafetyTimerFormat 同口径）', () => {
  it('剩余时间：<1h 只报分钟，≥1h 报小时+分钟', () => {
    expect(remainingText(1800, 'zh')).toBe('还有约 30 分钟')
    expect(remainingText(5400, 'zh')).toBe('还有约 1 小时 30 分钟')
    expect(remainingText(3660, 'en')).toContain('1h')
  })
  it('负值/0 夹到 0，不产生负数或崩', () => {
    expect(remainingText(-50, 'zh')).toBe('还有约 0 分钟')
    expect(remainingText(0, 'en')).toContain('0')
  })
  it('时长名：整点小时用"小时/h"，否则分钟', () => {
    expect(durationName(30, 'zh')).toBe('30 分钟')
    expect(durationName(120, 'zh')).toBe('2 小时')
    expect(durationName(120, 'en')).toBe('2h')
    expect(durationName(90, 'zh')).toBe('90 分钟') // 非整点小时仍按分钟
  })
})
