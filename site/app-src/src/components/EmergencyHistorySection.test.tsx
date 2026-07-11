// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../lib/api', () => ({ api: { emergencyHistory: vi.fn() }, APIError: class extends Error {} }))
import { api } from '../lib/api'
import { EmergencyHistorySection } from './EmergencyHistorySection'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('EmergencyHistorySection 紧急事件历史（折叠、懒加载、结果标签）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('展开才拉取；渲染类型 + 结果标签（已报平安/升级无人响应）+ 触达数 + 地图链接', async () => {
    mock(api.emergencyHistory).mockResolvedValue({ history: [
      { id: 'e2', kind: 'manual', at: 3000, notified: 0, contacts: 1, acked: false, escalated: true, resolved: false, lat: null, lon: null },
      { id: 'e1', kind: 'fall', at: 1000, notified: 2, contacts: 3, acked: false, escalated: false, resolved: true, lat: 31.2, lon: 121.4 },
    ] })
    render(<EmergencyHistorySection />)
    expect(api.emergencyHistory).not.toHaveBeenCalled() // 懒加载
    fireEvent.click(screen.getByRole('button', { name: /紧急事件历史/ }))
    await waitFor(() => expect(api.emergencyHistory).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('手动 SOS')).toBeInTheDocument()
    expect(screen.getByText('疑似摔倒')).toBeInTheDocument()
    expect(screen.getByText('已报平安')).toBeInTheDocument()               // resolved
    expect(screen.getByText('升级后仍无人响应')).toBeInTheDocument()        // escalated 未 ack 未 resolved
    expect(screen.getByText(/触达 2\/3/)).toBeInTheDocument()
    // 有坐标才有地图链接：e1 有、e2 无 → 恰 1 个。
    expect(screen.getAllByRole('link', { name: '在地图查看' })).toHaveLength(1)
  })

  it('兜底「最后已知」坐标 → 诚实标注 ⚠️最后位置·定位时刻（回看时不把旧点当实时）；实时坐标标"在地图查看"', async () => {
    const at = Date.now() - 10 * 60_000
    mock(api.emergencyHistory).mockResolvedValue({ history: [
      { id: 'stale', kind: 'fall', at, notified: 1, contacts: 2, acked: false, escalated: false, resolved: false, lat: 22.5, lon: 114.1, locSource: 'lastKnown', locAgeSec: 900 },
      { id: 'live', kind: 'manual', at: at - 1000, notified: 1, contacts: 1, acked: true, escalated: false, resolved: true, lat: 31.2, lon: 121.4, locSource: 'live' },
    ] })
    render(<EmergencyHistorySection />)
    fireEvent.click(screen.getByRole('button', { name: /紧急事件历史/ }))
    // 最后已知 → ⚠️最后位置 链接 + title 绝对时刻；实时 → 普通"在地图查看"。
    const staleLink = await screen.findByRole('link', { name: /最后位置/ })
    expect(staleLink.textContent).toContain('⚠️')
    expect(staleLink).toHaveAttribute('title')
    expect(screen.getByRole('link', { name: '在地图查看' })).toBeInTheDocument() // 实时那条仍是普通标签
  })

  it('空历史 → "暂无紧急事件记录"', async () => {
    mock(api.emergencyHistory).mockResolvedValue({ history: [] })
    render(<EmergencyHistorySection />)
    fireEvent.click(screen.getByRole('button', { name: /紧急事件历史/ }))
    expect(await screen.findByText('暂无紧急事件记录')).toBeInTheDocument()
  })
})
