// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 经 /chat/:peerId 预选单聊，验证单聊免打扰开关。
vi.mock('react-router-dom', () => ({ useParams: () => ({ peerId: 'p1' }), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  api: {
    conversations: vi.fn(), groups: vi.fn(), messagesWith: vi.fn(), markRead: vi.fn(),
    lookupUser: vi.fn(), familyLinks: vi.fn(), searchMessages: vi.fn(), muteConversation: vi.fn(),
  },
  APIError: class extends Error { code = ''; status = 0 },
  chatErrorText: () => 'err',
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const convList = (muted: boolean) => ({ conversations: [{ peer: { id: 'p1', displayName: '阿明', avatar: null }, last: { id: 'm', fromId: 'p1', toId: 'me', kind: 'text', text: '嗨', createdAt: 1000 }, unread: 0, muted }] })

describe('单聊免打扰 UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    mock(api.groups).mockResolvedValue({ groups: [] })
    mock(api.markRead).mockResolvedValue({})
    mock(api.lookupUser).mockResolvedValue({ user: null })
    mock(api.familyLinks).mockResolvedValue({ links: [] })
    mock(api.messagesWith).mockResolvedValue({ messages: [] })
  })

  it('预选单聊 → 显示"静音"；点击调 muteConversation(true) 并乐观变"已静音"', async () => {
    mock(api.conversations).mockResolvedValue(convList(false))
    mock(api.muteConversation).mockResolvedValue({ muted: true })
    render(<ChatPage />)
    const btn = await screen.findByTestId('mute-toggle')
    expect(btn).toHaveTextContent('静音')
    fireEvent.click(btn)
    await waitFor(() => expect(api.muteConversation).toHaveBeenCalledWith('p1', true))
    expect(btn).toHaveTextContent('已静音')
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('已静音单聊：侧栏会话行显示🔕，头部按钮为"已静音"', async () => {
    mock(api.conversations).mockResolvedValue(convList(true))
    render(<ChatPage />)
    expect(await screen.findByLabelText('已静音')).toBeInTheDocument() // 会话行🔕
    expect(await screen.findByTestId('mute-toggle')).toHaveTextContent('已静音')
  })
})
