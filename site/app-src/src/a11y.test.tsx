// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
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
  useParams: () => ({}), // Chat 会话列表态（无预选 peer）
  Link: (p: { to: string; children: unknown; className?: string; 'aria-label'?: string }) => <a href={p.to} className={p.className} aria-label={p['aria-label']}>{p.children as never}</a>,
}))
vi.mock('./lib/session', () => ({ useSession: () => ({ signIn: vi.fn(), refreshMe: vi.fn(), signOut: vi.fn(), user: { id: 'me', displayName: '阿明', role: 'helper' } }) }))
// Leaflet 桩化（Locations 挂载即建地图；地图 canvas 非 axe 审计点，页面 chrome 才是）。
const leafletChain = (): unknown => {
  const o: Record<string, ReturnType<typeof vi.fn>> = {}
  const h: unknown = new Proxy(o, { get: (t, k: string) => (t[k] ??= vi.fn(() => h)) })
  return h
}
vi.mock('leaflet', () => ({ default: new Proxy({}, { get: () => vi.fn(() => leafletChain()) }) }))
vi.mock('leaflet/dist/leaflet.css', () => ({}))
vi.mock('./lib/api', () => ({
  SEARCH_LIMIT: 50, GLOBAL_SEARCH_LIMIT: 20,
  chatErrorText: () => '', fetchMediaObjectURL: vi.fn(), uploadMedia: vi.fn(),
  api: {
    notifications: vi.fn(), markAllNotifsRead: vi.fn(), markNotifRead: vi.fn(),
    onlineCount: vi.fn(), incomingCalls: vi.fn(), helpQueue: vi.fn(), unreadSummary: vi.fn(), incomingLinks: vi.fn(), callHistory: vi.fn(), watchingEmergencies: vi.fn(() => Promise.resolve({ active: [] })),
    myRecordings: vi.fn(),
    conversations: vi.fn(), groups: vi.fn(), messagesWith: vi.fn(), markRead: vi.fn(), lookupUser: vi.fn(), familyLinks: vi.fn(), searchMessages: vi.fn(), sendMessage: vi.fn(), editMessage: vi.fn(),
    contactLocations: vi.fn(), updateLocation: vi.fn(), stopSharingLocation: vi.fn(), savedPlaces: vi.fn(), requestLocation: vi.fn(), upsertPlace: vi.fn(), deletePlace: vi.fn(),
    verificationStatus: vi.fn(),
    emailRequestCode: vi.fn(() => Promise.resolve({ ok: true })), emailVerifyCode: vi.fn(),
  },
  APIError: class extends Error {},
}))
import { api } from './lib/api'
import { LoginPage } from './pages/Login'
import { NotificationsPage } from './pages/Notifications'
import { HomePage } from './pages/Home'
import { CallsPage } from './pages/Calls'
import { RecordingsPage } from './pages/Recordings'
import { ChatPage } from './pages/Chat'
import { LocationsPage } from './pages/Locations'
import { VerificationGate } from './pages/VerificationGate'

describe('axe 无障碍回归门禁（代表性页面 0 violations）', () => {
  it('登录页（含注册模式的身份选择）', async () => {
    const { container, getByRole } = render(<LoginPage />)
    await expectNoAxeViolations(container)
    // 注册模式（多出身份选择/更多表单控件）同样干净。
    getByRole('button', { name: '注册' }).click()
    await expectNoAxeViolations(container)
  })

  it('登录页·邮箱验证码面板（本会话新增：身份选择 role=group + hint + 验证码字段）0 violations', async () => {
    const { container, getByRole, findByLabelText } = render(<LoginPage />)
    getByRole('button', { name: /邮箱验证码登录/ }).click() // 进入邮箱码面板（含身份选择器 + 说明 hint）
    const emailInput = await findByLabelText('邮箱')
    await expectNoAxeViolations(container)
    // 发码后进入"填码"态（多出验证码字段）——同样无障碍干净。email 是 required，先填再发（jsdom 会做约束校验）。
    fireEvent.change(emailInput, { target: { value: 'helper@example.com' } })
    getByRole('button', { name: '发送验证码' }).click()
    await findByLabelText('验证码')
    await expectNoAxeViolations(container)
  })

  it('登录页·通行密钥按钮（本会话新增：浏览器支持时出现）0 violations', async () => {
    // jsdom 默认无 WebAuthn → 按钮不渲染；桩上 PublicKeyCredential+credentials 让 passkeySupported() 为真、按钮出现，验其无障碍。
    Object.defineProperty(window, 'PublicKeyCredential', { value: function () {}, configurable: true })
    Object.defineProperty(navigator, 'credentials', { value: { get: () => {}, create: () => {} }, configurable: true })
    try {
      const { container, getByRole } = render(<LoginPage />)
      getByRole('button', { name: /用通行密钥登录/ }) // 确认按钮已渲染（不存在即抛，测即红）
      await expectNoAxeViolations(container)
    } finally {
      // @ts-expect-error 复位测试桩：PublicKeyCredential 非可选属性
      delete window.PublicKeyCredential
      // @ts-expect-error 复位测试桩：navigator.credentials 非可选属性
      delete navigator.credentials
    }
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

  it('聊天页（会话列表 + 搜索框 + 新建群入口）——全站最高流量页', async () => {
    Element.prototype.scrollIntoView = vi.fn() // jsdom 未实现
    ;(api.conversations as ReturnType<typeof vi.fn>).mockResolvedValue({ conversations: [
      { peer: { id: 'p1', displayName: '李奶奶', avatar: null }, last: { id: 'm1', fromId: 'p1', toId: 'me', kind: 'text', text: '今天谢谢你', createdAt: 1000 }, unread: 2 },
    ] })
    ;(api.groups as ReturnType<typeof vi.fn>).mockResolvedValue({ groups: [] })
    ;(api.familyLinks as ReturnType<typeof vi.fn>).mockResolvedValue({ links: [] })
    const { container, findByText } = render(<ChatPage />)
    await findByText('李奶奶')
    await expectNoAxeViolations(container)
  })

  it('位置共享页（共享开关 + 时长选择 + 联系人行操作 + 请求共享）——安全功能页', async () => {
    ;(api.contactLocations as ReturnType<typeof vi.fn>).mockResolvedValue({ sharing: false, contacts: [
      { userId: 'c1', displayName: '女儿', role: 'helper', lat: 31.2, lng: 121.4, accuracy: 20, battery: 55, heading: null, updatedAt: Date.now() - 5000, avatar: null },
    ] })
    ;(api.familyLinks as ReturnType<typeof vi.fn>).mockResolvedValue({ links: [
      { id: 'l1', memberId: 'c2', memberName: '儿子', relation: '家人', isEmergency: true, status: 'accepted' },
    ] })
    ;(api.savedPlaces as ReturnType<typeof vi.fn>).mockResolvedValue({ places: [] })
    const { container, findByText } = render(<LocationsPage />)
    await findByText('女儿')
    await expectNoAxeViolations(container)
  })

  it('实名认证门禁屏（被拒态：原因说明 + 三个出口按钮）', async () => {
    ;(api.verificationStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'rejected', rejectReasonCode: 'blurry' })
    const { container, findByText } = render(<VerificationGate />)
    await findByText(/上次未通过/)
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
