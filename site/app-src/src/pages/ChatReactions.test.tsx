// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 逐用户表情回应胶囊：服务端每条消息带 reactions:[{emoji,count,mine}]；web 渲染成可点胶囊、按 mine 切换。
vi.mock('react-router-dom', () => ({ useParams: () => ({ peerId: 'p1' }), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  api: { conversations: vi.fn(), groups: vi.fn(), messagesWith: vi.fn(), markRead: vi.fn(), lookupUser: vi.fn(), familyLinks: vi.fn(), searchMessages: vi.fn(), reactMessage: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('ChatPage 逐用户表情胶囊显示与切换', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn() // jsdom 未实现
    mock(api.conversations).mockResolvedValue({ conversations: [{ peer: { id: 'p1', displayName: '阿明', avatar: null }, last: null, unread: 0 }] })
    mock(api.groups).mockResolvedValue({ groups: [] })
    mock(api.markRead).mockResolvedValue({})
    mock(api.lookupUser).mockResolvedValue({ user: null })
    mock(api.familyLinks).mockResolvedValue({ links: [] })
    mock(api.searchMessages).mockResolvedValue({ messages: [] })
    mock(api.reactMessage).mockResolvedValue({})
  })

  const withReactions = (reactions: unknown, extra: Record<string, unknown> = {}) =>
    mock(api.messagesWith).mockResolvedValue({ messages: [{ id: 'm1', fromId: 'p1', toId: 'me', kind: 'text', text: '好耶', createdAt: 1000, ...(reactions ? { reactions } : {}), ...extra }] })

  it('渲染 reactions 数组为胶囊：每 emoji 一枚，count>1 显数量，我参与的 aria 含"含你"', async () => {
    withReactions([{ emoji: '👍', count: 2, mine: true }, { emoji: '❤️', count: 1, mine: false }])
    render(<ChatPage />)
    await screen.findByText('好耶')
    const chips = screen.getAllByTestId('reaction-chip')
    expect(chips).toHaveLength(2)
    expect(chips[0].textContent).toContain('👍'); expect(chips[0].textContent).toContain('2') // count>1 显数量
    expect(chips[1].textContent).toContain('❤️'); expect(chips[1].textContent).not.toContain('1') // count=1 不显数字
    expect(chips[0].getAttribute('aria-label')).toContain('含你')     // 👍 是我的
    expect(chips[1].getAttribute('aria-label')).not.toContain('含你') // ❤️ 不是我的
  })

  it('点我已选胶囊(👍 mine)=取消 → reactMessage(id,"")；点别的(❤️)=改选 → reactMessage(id,"❤️")', async () => {
    withReactions([{ emoji: '👍', count: 2, mine: true }, { emoji: '❤️', count: 1, mine: false }])
    render(<ChatPage />)
    await screen.findByText('好耶')
    const chips = screen.getAllByTestId('reaction-chip')
    fireEvent.click(chips[0]) // 我的 👍 → 取消（空串）
    await waitFor(() => expect(api.reactMessage).toHaveBeenCalledWith('m1', ''))
    fireEvent.click(chips[1]) // ❤️（非我的、我当前是👍）→ 改成 ❤️（每人至多一个，后端替换）
    await waitFor(() => expect(api.reactMessage).toHaveBeenCalledWith('m1', '❤️'))
  })

  it('旧服务端只回单字段 reaction（无 reactions 数组）→ 兜底合成一枚胶囊显示', async () => {
    withReactions(null, { reaction: '😂' })
    render(<ChatPage />)
    await screen.findByText('好耶')
    const chips = screen.getAllByTestId('reaction-chip')
    expect(chips).toHaveLength(1)
    expect(chips[0].textContent).toContain('😂')
  })

  it('无任何回应 → 不渲染胶囊', async () => {
    withReactions(null)
    render(<ChatPage />)
    await screen.findByText('好耶')
    expect(screen.queryByTestId('reaction-chip')).toBeNull()
  })
})
