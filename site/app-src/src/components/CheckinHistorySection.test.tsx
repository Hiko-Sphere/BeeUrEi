// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../lib/api', () => ({ api: { checkinHistory: vi.fn() }, APIError: class extends Error {} }))
import { api } from '../lib/api'
import { CheckinHistorySection } from './CheckinHistorySection'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('CheckinHistorySection 报到历史（折叠、懒加载、状态标签）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('展开才拉取；渲染各状态标签（完成/告警/取消）+ 备注', async () => {
    mock(api.checkinHistory).mockResolvedValue({ history: [
      { id: 't3', status: 'fired', startedAt: 3000, dueAt: 4000, note: null, endedAt: 4000 },
      { id: 't2', status: 'canceled', startedAt: 2000, dueAt: 3000, note: null, endedAt: 2500 },
      { id: 't1', status: 'completed', startedAt: 1000, dueAt: 2000, note: '步行回家', endedAt: 1500 },
    ] })
    render(<CheckinHistorySection />)
    expect(api.checkinHistory).not.toHaveBeenCalled() // 未展开不拉取（懒加载）
    fireEvent.click(screen.getByRole('button', { name: '查看报到历史' }))
    await waitFor(() => expect(api.checkinHistory).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('已告警亲友')).toBeInTheDocument() // fired
    expect(screen.getByText('已报平安')).toBeInTheDocument()          // completed
    expect(screen.getByText('已取消')).toBeInTheDocument()            // canceled
    expect(screen.getByText(/步行回家/)).toBeInTheDocument()          // 备注
    // 再次点击收起后再展开 → 不重复拉取（items 已缓存）。
    fireEvent.click(screen.getByRole('button', { name: '收起报到历史' }))
    fireEvent.click(screen.getByRole('button', { name: '查看报到历史' }))
    expect(api.checkinHistory).toHaveBeenCalledTimes(1)
  })

  it('空历史 → "暂无报到记录"', async () => {
    mock(api.checkinHistory).mockResolvedValue({ history: [] })
    render(<CheckinHistorySection />)
    fireEvent.click(screen.getByRole('button', { name: '查看报到历史' }))
    expect(await screen.findByText('暂无报到记录')).toBeInTheDocument()
  })
})
