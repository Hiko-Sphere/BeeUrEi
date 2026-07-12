// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axeViolations } from '../lib/axeCheck'

/// 通知页无障碍门禁：Notifications 是**紧急告警落地页**（SOS「我在赶来/我已看到」回执、位置请求、
/// 一键回拨、深链），此前不在 axe 门禁内。服务视障用户的亲友（本身也可能有障碍）——每条通知带多个
/// 图标操作按钮（回执/回拨/删除/前往），无可访问名或 aria 误用会让读屏亲友无法在紧急时刻响应。
/// 回归必须挡在合并前。axe 配置见 lib/axeCheck.ts（color-contrast/region 因 jsdom 限制禁用，其余全效）。

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: (p: { to: string; children: unknown; className?: string; 'aria-label'?: string }) => <a href={p.to} className={p.className} aria-label={p['aria-label']}>{p.children as never}</a>,
}))
vi.mock('./call/CallController', () => ({ useCall: () => ({ active: null, startOutgoing: vi.fn() }) }))
vi.mock('../lib/api', () => ({
  api: {
    notifications: vi.fn(),
    emergencyAck: vi.fn(), markAllNotifsRead: vi.fn(), markNotifRead: vi.fn(),
    deleteNotif: vi.fn(), clearReadNotifs: vi.fn(), contactMedicalInfo: vi.fn(),
  },
  APIError: class extends Error {},
}))
import { api } from '../lib/api'
import { NotificationsPage } from './Notifications'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('Notifications 页无障碍门禁（axe 0 violations）', () => {
  it('SOS 告警行（回执/回拨/查看位置/前往）+ 位置请求 + 普通通知：图标操作均有可访问名，0 violations', async () => {
    // 覆盖高交互密度的行：紧急告警（多按钮）+ 位置请求 + 已读/未读混排 + 深链。
    mock(api.notifications).mockResolvedValue({
      notifications: [
        { id: 'n1', userId: 'me', kind: 'emergency_alert', title: '小明发出紧急求助', body: '疑似摔倒',
          data: { fromId: 'u1', fromName: '小明', eventId: 'e1', lat: '31.2', lon: '121.4', locSource: 'live', hasMedical: '1' }, createdAt: Date.now() },
        { id: 'n2', userId: 'me', kind: 'location_request', title: '小红请求共享你的位置', body: '',
          data: { fromId: 'u2', fromName: '小红' }, createdAt: Date.now() - 1000 },
        { id: 'n3', userId: 'me', kind: 'message_pinned', title: '群里置顶了一条消息', body: '记得带钥匙',
          data: { groupId: 'g1' }, createdAt: Date.now() - 2000, readAt: Date.now() - 1000 },
        { id: 'n4', userId: 'me', kind: 'report_resolved', title: '举报已处理', body: '感谢反馈', data: {}, createdAt: Date.now() - 3000 },
      ],
      unread: 3,
      hasMore: false,
    })
    const { container } = render(<NotificationsPage />)
    await screen.findByText('小明发出紧急求助')
    expect(await axeViolations(container)).toEqual([])
  })

  it('空态（无通知）也 0 violations', async () => {
    mock(api.notifications).mockResolvedValue({ notifications: [], unread: 0, hasMore: false })
    const { container } = render(<NotificationsPage />)
    // 等一帧让空态渲染完成。
    await new Promise((r) => setTimeout(r, 0))
    expect(await axeViolations(container)).toEqual([])
  })
})
