// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 只 mock api（useI18n 有默认 ctx，t 返回中文，无需 Provider）。useCall 有默认 ctx 无需 mock；
// useNavigate 用 hoisted 稳定 spy 以断言跳转。
const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('../lib/api', () => ({
  api: { notifications: vi.fn(), markAllNotifsRead: vi.fn(), markNotifRead: vi.fn() },
}))
import { api } from '../lib/api'
import { NotificationsPage, notifDestination } from './Notifications'

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
    // 必须用 Apple Maps（境内可开 + WGS-84 自动纠偏），不得回退 Google Maps（境内被墙 + 坐标偏移）。
    expect(link?.getAttribute('href')).toContain('maps.apple.com')
    expect(link?.getAttribute('href')).not.toContain('google')
  })

  it('通知主操作是可键盘聚焦的 button：激活→标已读 + 跳可操作页（好友→/family）', async () => {
    ;(api.notifications as ReturnType<typeof vi.fn>).mockResolvedValue({
      notifications: [notif({ id: 'f1', kind: 'friend_request', title: '新的好友请求', body: '阿明想加你' })],
      unread: 1,
    })
    ;(api.markNotifRead as ReturnType<typeof vi.fn>).mockResolvedValue({})
    render(<NotificationsPage />)
    // 主操作是 button（键盘可 Tab+Enter 激活），而非挂 onClick 的裸 <li>。
    const btn = await screen.findByRole('button', { name: /新的好友请求/ })
    fireEvent.click(btn)
    await waitFor(() => expect(api.markNotifRead).toHaveBeenCalledWith('f1'))
    expect(h.nav).toHaveBeenCalledWith('/family') // friend_request → 亲友页
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

describe('notifDestination 通知跳转（子串路由，防 link/security 撞车）', () => {
  it('账号安全类先判：绑/解绑 Apple 登录（含子串 "link"）→ /account，绝不被 friend/link 抢到 /family', () => {
    expect(notifDestination('security_apple_linked')).toBe('/account')
    expect(notifDestination('security_apple_unlinked')).toBe('/account')
    expect(notifDestination('security_password_changed')).toBe('/account')
    expect(notifDestination('security_passkey_added')).toBe('/account')
    expect(notifDestination('medical_info_viewed')).toBe('/account')
    expect(notifDestination('kyc_verified')).toBe('/account')
  })
  it('好友/群/路线/位置各归其页；无明确去处→null', () => {
    expect(notifDestination('friend_request')).toBe('/family')
    expect(notifDestination('group_added')).toBe('/chat')
    expect(notifDestination('route_added')).toBe('/routes')
    expect(notifDestination('place_arrival')).toBe('/locations')
    expect(notifDestination('contact_critical_battery')).toBe('/locations')
    expect(notifDestination('chat_message')).toBeNull()
  })
})
