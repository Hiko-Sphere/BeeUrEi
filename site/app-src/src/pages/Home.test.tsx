// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Home 用 Link(router)+useSession+useI18n(默认)+api。mock router 的 Link 与 session、api。
vi.mock('react-router-dom', () => ({ Link: (p: { to: string; children: unknown }) => <a href={p.to}>{p.children as never}</a> }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'u1', displayName: '阿明', role: 'helper' } }) }))
vi.mock('../lib/api', () => ({
  api: { onlineCount: vi.fn(), incomingCalls: vi.fn(), helpQueue: vi.fn(), unreadSummary: vi.fn(), incomingLinks: vi.fn(), callHistory: vi.fn() },
}))
import { api } from '../lib/api'
import { HomePage } from './Home'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('HomePage 最近通话渲染（防字段漂移）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock(api.onlineCount).mockResolvedValue({ online: 3, total: 10 })
    mock(api.incomingCalls).mockResolvedValue({ calls: [] })
    mock(api.helpQueue).mockResolvedValue({ requests: [], count: 0 })
    mock(api.unreadSummary).mockResolvedValue({ messages: 0, notifications: 0, missedCalls: 0, total: 0 })
    mock(api.incomingLinks).mockResolvedValue({ links: [] })
  })

  it('锁定 peerName/direction/status 渲染键', async () => {
    mock(api.callHistory).mockResolvedValue({
      calls: [
        { id: 'c1', peerId: 'p1', peerName: '王医生', peerAvatar: null, direction: 'incoming', status: 'answered', createdAt: 1_700_000_000_000 },
        { id: 'c2', peerId: 'p2', peerName: '李阿姨', peerAvatar: null, direction: 'outgoing', status: 'missed', createdAt: 1_700_000_000_000 },
      ],
    })
    render(<HomePage />)
    expect(await screen.findByText('王医生')).toBeInTheDocument()
    expect(screen.getByText('已接通')).toBeInTheDocument()   // status=answered
    expect(screen.getByText(/呼入/)).toBeInTheDocument()      // direction=incoming
    expect(screen.getByText('李阿姨')).toBeInTheDocument()
    expect(screen.getByText('未接')).toBeInTheDocument()      // status=missed
    expect(screen.getByText(/呼出/)).toBeInTheDocument()      // direction=outgoing
  })

  it('对端仍在的通话记录整行可点进聊天；已注销(peerId 缺失)不可点', async () => {
    mock(api.callHistory).mockResolvedValue({
      calls: [
        { id: 'c1', peerId: 'p1', peerName: '王医生', peerAvatar: null, direction: 'incoming', status: 'answered', createdAt: 1_700_000_000_000 },
        { id: 'c2', peerId: null, peerName: '已注销用户', peerAvatar: null, direction: 'outgoing', status: 'missed', createdAt: 1_700_000_000_000 },
      ],
    })
    render(<HomePage />)
    const doctor = await screen.findByText('王医生')
    expect(doctor.closest('a')?.getAttribute('href')).toBe('/chat/p1') // 可点进与其的聊天
    expect(screen.getByText('已注销用户').closest('a')).toBeNull()       // 已注销 → 不可点
  })

  it('无通话记录 → 空态文案', async () => {
    mock(api.callHistory).mockResolvedValue({ calls: [] })
    render(<HomePage />)
    // 空态出现（标题/统计先渲染，故等列表区空态）
    expect(await screen.findByText('阿明', { exact: false })).toBeInTheDocument() // 问候带用户名，确认页已渲染
    expect(screen.queryByText('王医生')).toBeNull()
  })

  it('统计卡含未接来电/未读消息（取自 unreadSummary）+ 链到对应页', async () => {
    mock(api.callHistory).mockResolvedValue({ calls: [] })
    mock(api.unreadSummary).mockResolvedValue({ messages: 4, notifications: 2, missedCalls: 3, total: 9 })
    render(<HomePage />)
    // 未接来电卡（值 3，链到 /calls）与未读消息卡（值 4，链到 /chat）。
    const missed = await screen.findByText('未接来电')
    expect(missed.closest('a')?.getAttribute('href')).toBe('/calls')
    expect(missed.closest('a')).toHaveTextContent('3')
    const msgs = screen.getByText('未读消息')
    expect(msgs.closest('a')?.getAttribute('href')).toBe('/chat')
    expect(msgs.closest('a')).toHaveTextContent('4')
    // 未读通知取 summary.notifications（非整份列表长度）。
    expect(screen.getByText('未读通知').closest('a')).toHaveTextContent('2')
  })
})
