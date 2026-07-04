// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-router-dom', () => ({ useParams: () => ({}), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  api: {
    conversations: vi.fn(), groups: vi.fn(), messagesWith: vi.fn(), groupMessages: vi.fn(),
    markRead: vi.fn(), markGroupRead: vi.fn(), lookupUser: vi.fn(), familyLinks: vi.fn(),
    searchMessages: vi.fn(), muteGroup: vi.fn(),
  },
  APIError: class extends Error { code = ''; status = 0 },
  chatErrorText: () => 'err',
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const groupList = (muted: boolean) => ({
  groups: [{
    group: { id: 'g1', name: '家人群', ownerId: 'me', memberIds: ['me', 'p1'], createdAt: 1000 },
    members: [{ id: 'me', displayName: '我' }, { id: 'p1', displayName: '阿明' }],
    last: null, unread: 0, muted,
  }],
})

describe('群免打扰 UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    mock(api.conversations).mockResolvedValue({ conversations: [] })
    mock(api.markGroupRead).mockResolvedValue({})
    mock(api.lookupUser).mockResolvedValue({ user: null })
    mock(api.familyLinks).mockResolvedValue({ links: [] })
    mock(api.groupMessages).mockResolvedValue({ messages: [] })
  })

  it('点开群 → 显示"静音"；点击调 muteGroup(true) 并乐观变"已静音"', async () => {
    mock(api.groups).mockResolvedValue(groupList(false))
    mock(api.muteGroup).mockResolvedValue({ muted: true })
    render(<ChatPage />)
    fireEvent.click(await screen.findByText('家人群'))
    const btn = await screen.findByTestId('mute-toggle')
    expect(btn).toHaveTextContent('静音')
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(btn)
    await waitFor(() => expect(api.muteGroup).toHaveBeenCalledWith('g1', true))
    expect(btn).toHaveTextContent('已静音')                 // 乐观更新
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('已静音的群：侧栏行显示🔕标记，点开后按钮为"已静音"', async () => {
    mock(api.groups).mockResolvedValue(groupList(true))
    render(<ChatPage />)
    // 侧栏行的静音标记（无障碍名"已静音"）。
    expect(await screen.findByLabelText('已静音')).toBeInTheDocument()
    fireEvent.click(screen.getByText('家人群'))
    expect(await screen.findByTestId('mute-toggle')).toHaveTextContent('已静音')
  })
})
