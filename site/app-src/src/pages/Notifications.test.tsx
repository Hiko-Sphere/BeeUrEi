// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 只 mock api（useI18n 有默认 ctx，t 返回中文，无需 Provider）。useCall 有默认 ctx 无需 mock；
// useNavigate 用 hoisted 稳定 spy 以断言跳转。
const h = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('../lib/api', () => ({
  api: { notifications: vi.fn(), markAllNotifsRead: vi.fn(), markNotifRead: vi.fn(), contactMedicalInfo: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { NotificationsPage, notifDestination } from './Notifications'

const notif = (over: Record<string, unknown>) => ({
  id: 'n', userId: 'u1', kind: 'report_resolved', title: 't', body: 'b', createdAt: 1_700_000_000_000, ...over,
})

describe('NotificationsPage 渲染（防字段漂移）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('被设为紧急联系人用人形图标、非 SOS 告警闪电（emergency_contact_set 含子串 emergency 曾误配闪电）', async () => {
    ;(api.notifications as ReturnType<typeof vi.fn>).mockResolvedValue({
      notifications: [notif({ id: 'ec1', kind: 'emergency_contact_set', title: '你被设为紧急联系人', body: '张三把你设为紧急联系人' })],
      unread: 1,
    })
    const { container } = render(<NotificationsPage />)
    expect(await screen.findByText('你被设为紧急联系人')).toBeInTheDocument()
    // 不得出现 SOS 告警闪电（IconFlash 的独特闪电路径）——那是给真实紧急告警的，善意关系事件不该像危险告警。
    expect(container.querySelector('path[d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"]')).toBeNull()
    // 应为人形图标（IconUsers 的头部圆）。
    expect(container.querySelector('circle[cx="9"]')).not.toBeNull()
  })

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

  it('紧急告警（带 fromId）在通知列表也提供"查看医疗信息"——与告警模态一致，事后回看仍可查', async () => {
    ;(api.notifications as ReturnType<typeof vi.fn>).mockResolvedValue({
      notifications: [notif({ id: 'e1', kind: 'emergency_alert', title: '摔倒告警', body: '可能摔倒', data: { fromId: 'blind1', fromName: '小明', hasMedical: '1' } })],
      unread: 1,
    })
    render(<NotificationsPage />)
    expect(await screen.findByText('摔倒告警')).toBeInTheDocument()
    expect(screen.getByTestId('view-medical-btn')).toBeInTheDocument() // 医疗查看按钮出现在列表里
  })

  it('非 SOS 通知（无 fromId，如被设为紧急联系人）不显示医疗查看按钮', async () => {
    ;(api.notifications as ReturnType<typeof vi.fn>).mockResolvedValue({
      notifications: [notif({ id: 'ec1', kind: 'emergency_contact_set', title: '你被设为紧急联系人', body: 'X', data: { linkId: 'l1' } })],
      unread: 1,
    })
    render(<NotificationsPage />)
    expect(await screen.findByText('你被设为紧急联系人')).toBeInTheDocument()
    expect(screen.queryByTestId('view-medical-btn')).toBeNull() // 无 fromId → 不显示（fromId 门排除关系事件）
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
