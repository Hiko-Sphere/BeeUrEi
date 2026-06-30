// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// 只 mock api（useI18n 有默认 ctx，t 返回中文，无需 Provider）。
vi.mock('../lib/api', () => ({
  api: { notifications: vi.fn(), markAllNotifsRead: vi.fn(), markNotifRead: vi.fn() },
}))
import { api } from '../lib/api'
import { NotificationsPage } from './Notifications'

const notif = (over: Record<string, unknown>) => ({
  id: 'n', userId: 'u1', kind: 'report_resolved', title: 't', body: 'b', createdAt: 1_700_000_000_000, ...over,
})

describe('NotificationsPage 渲染（防字段漂移）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('紧急告警带 lat/lon → 渲染"查看位置"链接，href 含坐标', async () => {
    ;(api.notifications as ReturnType<typeof vi.fn>).mockResolvedValue({
      notifications: [notif({ id: 'e1', kind: 'emergency_alert', title: '摔倒告警', body: '可能摔倒', data: { lat: '31.2', lon: '121.4', kind: 'fall' } })],
      unread: 1,
    })
    render(<NotificationsPage />)
    expect(await screen.findByText('摔倒告警')).toBeInTheDocument()
    const link = (await screen.findByText(/查看位置/)).closest('a')
    expect(link?.getAttribute('href')).toContain('31.2')
    expect(link?.getAttribute('href')).toContain('121.4')
  })

  it('无坐标的通知 → 不渲染位置链接，仍显示标题/正文', async () => {
    ;(api.notifications as ReturnType<typeof vi.fn>).mockResolvedValue({
      notifications: [notif({ id: 'r1', title: '处置完成', body: '已处理你的举报' })],
      unread: 0,
    })
    render(<NotificationsPage />)
    expect(await screen.findByText('处置完成')).toBeInTheDocument()
    expect(screen.queryByText(/查看位置/)).toBeNull()
  })
})
