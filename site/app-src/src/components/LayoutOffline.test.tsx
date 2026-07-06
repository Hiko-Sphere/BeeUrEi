// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 离线可见化（假安心防护）：轮询失败/断网 → "网络已断开"横幅；恢复由下一次成功轮询清除。
vi.mock('react-router-dom', () => ({
  NavLink: (p: { to: string; children: unknown }) => <a href={p.to}>{p.children as never}</a>,
  useLocation: () => ({ pathname: '/' }),
}))
vi.mock('../lib/session', () => ({
  useSession: () => ({ user: { id: 'u1', username: 'amy', displayName: '阿明', role: 'helper' }, self: null, signOut: vi.fn(), refreshMe: vi.fn() }),
}))
vi.mock('../lib/api', () => ({
  api: {
    appConfig: vi.fn().mockResolvedValue({}),
    unreadSummary: vi.fn(),
    heartbeat: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('../pages/call/CallController', () => ({ CallProvider: (p: { children: unknown }) => p.children as never }))
import { Layout } from './Layout'
import { api } from '../lib/api'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const BANNER = /网络已断开/

describe('Layout 离线横幅（收不到新告警必须显式可见）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('未读轮询失败 → 显示"网络已断开"（role=alert）；恢复后（online 事件触发重试且成功）→ 横幅消失', async () => {
    mock(api.unreadSummary).mockRejectedValueOnce(new Error('network')) // 首次轮询失败
    render(<Layout><div>正文</div></Layout>)
    expect(await screen.findByRole('alert')).toHaveTextContent(BANNER) // 失败即亮，绝不静默装正常
    // 网络恢复：online 事件立即重试轮询，本次成功 → 清横幅。
    mock(api.unreadSummary).mockResolvedValue({ notifications: 0, messages: 0, missedCalls: 0 })
    fireEvent(window, new Event('online'))
    await waitFor(() => expect(screen.queryByText(BANNER)).toBeNull())
  })

  it('浏览器 offline 事件 → 即刻显示横幅（不等下一次 30s 轮询）', async () => {
    mock(api.unreadSummary).mockResolvedValue({ notifications: 0, messages: 0, missedCalls: 0 }) // 轮询本身正常
    render(<Layout><div>正文</div></Layout>)
    await waitFor(() => expect(api.unreadSummary).toHaveBeenCalled())
    expect(screen.queryByText(BANNER)).toBeNull() // 在线：无横幅
    fireEvent(window, new Event('offline'))
    expect(await screen.findByText(BANNER)).toBeInTheDocument()
  })

  it('online 事件只触发重试、不盲目清横幅：服务器仍不可达（重试仍失败）→ 横幅保留', async () => {
    mock(api.unreadSummary).mockRejectedValue(new Error('network')) // 一直失败（接口恢复≠服务器可达）
    render(<Layout><div>正文</div></Layout>)
    expect(await screen.findByText(BANNER)).toBeInTheDocument()
    fireEvent(window, new Event('online')) // 网络接口恢复，但重试仍失败
    await waitFor(() => expect(mock(api.unreadSummary).mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(screen.getByText(BANNER)).toBeInTheDocument() // 不因 online 事件本身而误清
  })
})
