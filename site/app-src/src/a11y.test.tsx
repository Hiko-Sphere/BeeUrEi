// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import axe from 'axe-core' // 直接用于下方"axe 自检"（证明 axe 在 jsdom 里确实生效）
import { axeViolations } from './lib/axeCheck'

/// 无障碍回归门禁（把 2026-07-03 的一次性 axe 人工审计固化进 CI）：渲染代表性页面跑 axe-core，
/// 0 violations 才绿——协助端服务视障用户的亲友，无障碍回归（丢 label/按钮无名/aria 误用）必须被挡在合并前。
/// axe 配置见 lib/axeCheck.ts（color-contrast/region 因 jsdom 限制禁用，其余全效）。
async function expectNoAxeViolations(container: Element) {
  expect(await axeViolations(container)).toEqual([])
}

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: (p: { to: string; children: unknown; className?: string; 'aria-label'?: string }) => <a href={p.to} className={p.className} aria-label={p['aria-label']}>{p.children as never}</a>,
}))
vi.mock('./lib/session', () => ({ useSession: () => ({ signIn: vi.fn(), user: { id: 'me', displayName: '阿明', role: 'helper' } }) }))
vi.mock('./lib/api', () => ({
  api: {
    notifications: vi.fn(), markAllNotifsRead: vi.fn(), markNotifRead: vi.fn(),
    onlineCount: vi.fn(), incomingCalls: vi.fn(), helpQueue: vi.fn(), unreadSummary: vi.fn(), incomingLinks: vi.fn(), callHistory: vi.fn(),
    myRecordings: vi.fn(),
  },
  APIError: class extends Error {},
}))
import { api } from './lib/api'
import { LoginPage } from './pages/Login'
import { NotificationsPage } from './pages/Notifications'
import { HomePage } from './pages/Home'
import { CallsPage } from './pages/Calls'
import { RecordingsPage } from './pages/Recordings'

describe('axe 无障碍回归门禁（代表性页面 0 violations）', () => {
  it('登录页（含注册模式的身份选择）', async () => {
    const { container, getByRole } = render(<LoginPage />)
    await expectNoAxeViolations(container)
    // 注册模式（多出身份选择/更多表单控件）同样干净。
    getByRole('button', { name: '注册' }).click()
    await expectNoAxeViolations(container)
  })

  it('通知页（含紧急告警的位置链接与操作按钮）', async () => {
    ;(api.notifications as ReturnType<typeof vi.fn>).mockResolvedValue({
      notifications: [
        { id: 'e1', userId: 'u1', kind: 'emergency_alert', title: '摔倒告警', body: '可能摔倒',
          createdAt: 1_700_000_000_000, data: { lat: '31.2', lon: '121.4', kind: 'fall', fromId: 'x', fromName: '老王' } },
        { id: 'r1', userId: 'u1', kind: 'report_resolved', title: '处置完成', body: '已处理你的举报',
          createdAt: 1_700_000_000_000, readAt: 1_700_000_100_000 },
      ],
      unread: 1,
    })
    const { container, findByText } = render(<NotificationsPage />)
    await findByText('摔倒告警') // 等数据渲染完再审（空壳通过没有意义）
    await expectNoAxeViolations(container)
  })

  it('首页仪表盘（统计卡 + 最近通话含 🆘 与一键回拨）', async () => {
    ;(api.onlineCount as ReturnType<typeof vi.fn>).mockResolvedValue({ total: 3, online: 1 })
    ;(api.incomingCalls as ReturnType<typeof vi.fn>).mockResolvedValue({ calls: [] })
    ;(api.helpQueue as ReturnType<typeof vi.fn>).mockResolvedValue({ requests: [] })
    ;(api.unreadSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ notifications: 2, messages: 1, missedCalls: 1, total: 4 })
    ;(api.incomingLinks as ReturnType<typeof vi.fn>).mockResolvedValue({ links: [] })
    ;(api.callHistory as ReturnType<typeof vi.fn>).mockResolvedValue({ calls: [
      { id: 'c1', callId: 'k1', direction: 'incoming', status: 'missed', peerId: 'p1', peerName: '小明', peerAvatar: null, emergency: true, createdAt: 1_700_000_000_000 },
    ] })
    const { container, findByText } = render(<HomePage />)
    await findByText('小明') // 等最近通话渲染完（含紧急徽标 + 回拨按钮）再审
    await expectNoAxeViolations(container)
  })

  it('通话页（待接来电 + 求助队列 + 历史记录含回拨按钮）', async () => {
    ;(api.incomingCalls as ReturnType<typeof vi.fn>).mockResolvedValue({ calls: [
      { callId: 'in1', fromName: '老王', fromUserId: 'u9', fromAvatar: null, emergency: true },
    ] })
    ;(api.helpQueue as ReturnType<typeof vi.fn>).mockResolvedValue({ requests: [
      { callId: 'q1', fromName: '小红', fromAvatar: null, language: 'zh', locality: '上海', topic: '看快递单', waitedSeconds: 45 },
    ] })
    ;(api.callHistory as ReturnType<typeof vi.fn>).mockResolvedValue({ calls: [
      { id: 'c2', callId: 'k2', direction: 'outgoing', status: 'answered', peerId: 'p2', peerName: '阿华', peerAvatar: null, emergency: false, createdAt: 1_700_000_000_000 },
    ] })
    const { container, findByText } = render(<CallsPage />)
    await findByText('老王')
    await findByText('阿华')
    await expectNoAxeViolations(container)
  })

  it('录音页（列表含原因/参与者/播放删除操作）', async () => {
    ;(api.myRecordings as ReturnType<typeof vi.fn>).mockResolvedValue({ recordings: [
      { id: 'r1', callId: 'k3', ownerId: 'me', ownerName: '阿明', reason: '证据留存', recordedAt: 1_700_000_000_000,
        durationSec: 65, participantIds: ['me', 'p1'], participantNames: ['阿明', '小明'], hasMedia: true, deletedAt: null },
    ] })
    const { container, findByText } = render(<RecordingsPage />)
    await findByText(/证据留存/)
    await expectNoAxeViolations(container)
  })

  it('门禁自检：axe 在本环境确实能抓到违规（防"永远绿"的假门禁）', async () => {
    // 无名按钮 + 无 alt 图片：若 axe 在 jsdom 里静默失效，此测会红——保证上面的 0 violations 是真的。
    const host = document.createElement('div')
    host.innerHTML = '<button></button><img src="x.png">'
    document.body.appendChild(host)
    try {
      const results = await axe.run(host)
      const rules = results.violations.map((v) => v.id)
      expect(rules).toContain('button-name')
      expect(rules).toContain('image-alt')
    } finally {
      host.remove()
    }
  })
})
