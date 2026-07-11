// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { CheckinCountdown } from './CheckinCountdown'

describe('CheckinCountdown 安全报到实时倒计时', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('每秒重算：随时间推进，剩余分钟真实递减（不再冻结在初始快照）', () => {
    const base = 1_700_000_000_000
    vi.setSystemTime(base)
    render(<CheckinCountdown dueAt={base + 60 * 60_000} lang="zh" />) // 到期在 60 分钟后
    expect(screen.getByText('还有约 1 小时 0 分钟')).toBeInTheDocument()
    // 推进 30 分钟（interval 每秒触发 setNowMs）：应递减到约 30 分钟，而非冻结在 60。
    act(() => { vi.advanceTimersByTime(30 * 60_000) })
    expect(screen.getByText('还有约 30 分钟')).toBeInTheDocument()
  })

  it('过期后夹到 0，不显负数', () => {
    const base = 1_700_000_000_000
    vi.setSystemTime(base)
    render(<CheckinCountdown dueAt={base + 10_000} lang="zh" />) // 10s 后到期
    expect(screen.getByText('还有约 0 分钟')).toBeInTheDocument() // <1 分钟即显 0 分钟
    act(() => { vi.advanceTimersByTime(60_000) }) // 早已过期
    expect(screen.getByText('还有约 0 分钟')).toBeInTheDocument() // 夹 0，不为负
  })
})
