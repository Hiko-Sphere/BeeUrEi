import { describe, it, expect } from 'vitest'
import { remainingText, durationName, liveRemainingSecFromDue, nextCheckinLabel } from './safetyCheckin'

const tz = (zh: string) => zh // 少参可赋给 (zh,en)=>string,避开 no-unused-vars
const en = (_zh: string, e: string) => e

describe('safety check-in 剩余时间/时长格式（与 iOS SafetyTimerFormat 同口径）', () => {
  it('剩余时间：<1h 只报分钟，≥1h 报小时+分钟', () => {
    expect(remainingText(1800, 'zh')).toBe('还有约 30 分钟')
    expect(remainingText(5400, 'zh')).toBe('还有约 1 小时 30 分钟')
    expect(remainingText(3660, 'en')).toContain('1h')
    // 整点小时不拖"0 分钟"（"2 小时"而非"2 小时 0 分钟"；与 durationName 同口径）——24h 窗口每小时会经过整点。
    expect(remainingText(7200, 'zh')).toBe('还有约 2 小时')
    expect(remainingText(3600, 'zh')).toBe('还有约 1 小时')
    expect(remainingText(7200, 'en')).toBe('About 2h left')
    expect(remainingText(24 * 3600, 'zh')).toBe('还有约 24 小时') // 最长报到窗口
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
  it('nextCheckinLabel：当前早于报到时刻→"今天 HH:MM"，晚于→"明天 HH:MM"（双语；边界=时刻本身算明天）', () => {
    const at9 = 9 * 60 // 09:00
    expect(nextCheckinLabel(at9, new Date(2026, 0, 5, 8, 30), tz)).toBe('今天 09:00')  // 08:30 < 09:00 → 今天
    expect(nextCheckinLabel(at9, new Date(2026, 0, 5, 10, 0), tz)).toBe('明天 09:00')  // 10:00 > 09:00 → 明天
    expect(nextCheckinLabel(at9, new Date(2026, 0, 5, 9, 0), tz)).toBe('明天 09:00')   // 边界=时刻当刻算明天（今天窗口视为已过）
    expect(nextCheckinLabel(9 * 60 + 5, new Date(2026, 0, 5, 8, 0), en)).toBe('today at 09:05') // 双语 + 补零
  })

  it('liveRemainingSecFromDue：从 dueAt 实时递减，过期夹 0，坏输入→0（不显 NaN/负）', () => {
    const now = 1_700_000_000_000
    expect(liveRemainingSecFromDue(now + 60_000, now)).toBe(60)   // 还有 60s
    expect(liveRemainingSecFromDue(now + 3_600_000, now)).toBe(3600)
    expect(liveRemainingSecFromDue(now + 30_000, now + 20_000)).toBe(10) // 过了 20s → 剩 10s（真实递减）
    expect(liveRemainingSecFromDue(now - 5_000, now)).toBe(0)     // 已过期 → 0，绝不为负
    expect(liveRemainingSecFromDue(NaN, now)).toBe(0)             // 坏 dueAt → 0
    expect(liveRemainingSecFromDue(now + 60_000, Infinity)).toBe(0)
  })
})
