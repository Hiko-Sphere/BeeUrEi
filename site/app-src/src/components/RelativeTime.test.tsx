// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { RelativeTime } from './ui'

// 相对时间展示：可见文本相对、语义 <time> 携带精确绝对时间（悬停 + 屏幕阅读器可取）。
describe('RelativeTime', () => {
  it('可见=相对措辞；title/datetime=精确绝对时间（无障碍）', () => {
    const ms = Date.now() - 5 * 60_000
    const { container } = render(<RelativeTime ms={ms} lang="zh" />)
    const el = container.querySelector('time')!
    expect(el.textContent).toBe('5 分钟前')                                   // 可见文本相对
    expect(el.getAttribute('datetime')).toBe(new Date(ms).toISOString())      // 语义精确时刻
    expect(el.getAttribute('title')).toContain(String(new Date(ms).getFullYear())) // 悬停绝对含年份
  })
  it('英文档位（复用 timeAgo 措辞，全站一致）', () => {
    const { container } = render(<RelativeTime ms={Date.now() - 3 * 3_600_000} lang="en" />)
    expect(container.querySelector('time')!.textContent).toBe('3h ago')
  })
  it('className 透传', () => {
    const { container } = render(<RelativeTime ms={Date.now()} lang="zh" className="text-xs text-faint" />)
    expect(container.querySelector('time')!.className).toContain('text-faint')
  })
  it('非有限 ms 不崩溃：不构造 Date（toISOString 会抛 RangeError 白屏整页），降级为 <span> 兜底', () => {
    // 通知页 RelativeTime ms={n.createdAt}——若某条记录 createdAt 坏成 NaN，此前整页白屏，
    // 盲人发出的 SOS 协助者就看不到了。降级须无 <time>/datetime，纯文本"未知时间"。
    expect(() => render(<RelativeTime ms={NaN} lang="zh" />)).not.toThrow()
    const { container } = render(<RelativeTime ms={NaN} lang="zh" className="text-faint" />)
    expect(container.querySelector('time')).toBeNull()          // 不构造 <time>（否则要 toISOString → 抛）
    expect(container.querySelector('span')!.textContent).toBe('未知时间')
    expect(container.querySelector('span')!.className).toContain('text-faint') // className 仍透传
  })
})
