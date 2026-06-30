import { describe, it, expect } from 'vitest'
import { timeAgo, fmtDuration } from './ui'

describe('timeAgo', () => {
  const now = Date.now()
  it('刚刚 / 分钟 / 小时 / 天 各档；未来时间戳(时钟偏移)→刚刚，绝不显示负数', () => {
    expect(timeAgo(now, 'zh')).toBe('刚刚')
    expect(timeAgo(now - 5 * 60_000, 'zh')).toBe('5 分钟前')
    expect(timeAgo(now - 3 * 3_600_000, 'zh')).toBe('3 小时前')
    expect(timeAgo(now - 2 * 86_400_000, 'zh')).toBe('2 天前')
    expect(timeAgo(now + 60_000, 'zh')).toBe('刚刚') // 未来 → 刚刚（不出现 "-1 分钟前"）
  })
  it('英文档位不串中文', () => {
    expect(timeAgo(now - 5 * 60_000, 'en')).toBe('5m ago')
    expect(timeAgo(now - 3 * 3_600_000, 'en')).toBe('3h ago')
    expect(timeAgo(now, 'en')).toBe('just now')
  })
})

describe('fmtDuration', () => {
  it('m:ss，秒补零', () => {
    expect(fmtDuration(0)).toBe('0:00')
    expect(fmtDuration(5)).toBe('0:05')
    expect(fmtDuration(65)).toBe('1:05')
    expect(fmtDuration(600)).toBe('10:00')
  })
})
