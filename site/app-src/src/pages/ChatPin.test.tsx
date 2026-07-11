// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// 置顶消息横幅：服务端 GET /api/messages 回 pinned；web 顶部横幅显示、点跳转、X 取消；气泡菜单可置顶/取消。
vi.mock('react-router-dom', () => ({ useParams: () => ({ peerId: 'p1' }), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  api: { conversations: vi.fn(), groups: vi.fn(), messagesWith: vi.fn(), markRead: vi.fn(), lookupUser: vi.fn(), familyLinks: vi.fn(), searchMessages: vi.fn(), pinMessage: vi.fn(), unpinMessage: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('ChatPage 置顶消息横幅', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn() // jsdom 未实现
    mock(api.conversations).mockResolvedValue({ conversations: [{ peer: { id: 'p1', displayName: '阿明', avatar: null }, last: null, unread: 0 }] })
    mock(api.groups).mockResolvedValue({ groups: [] })
    mock(api.markRead).mockResolvedValue({})
    mock(api.lookupUser).mockResolvedValue({ user: null })
    mock(api.familyLinks).mockResolvedValue({ links: [] })
    mock(api.searchMessages).mockResolvedValue({ messages: [] })
    mock(api.pinMessage).mockResolvedValue({ pinned: null })
    mock(api.unpinMessage).mockResolvedValue(undefined)
  })

  it('响应带 pinned → 顶部横幅显示置顶内容 + 谁置顶；点横幅跳到原消息（scrollIntoView）', async () => {
    mock(api.messagesWith).mockResolvedValue({
      messages: [{ id: 'm1', fromId: 'p1', toId: 'me', kind: 'text', text: '家：幸福路9号', createdAt: 1000 }],
      pinned: { id: 'm1', fromId: 'p1', toId: 'me', kind: 'text', text: '家：幸福路9号', createdAt: 1000, pinnedByName: '阿明' },
    })
    render(<ChatPage />)
    const banner = await screen.findByTestId('pinned-banner')
    expect(banner.textContent).toContain('置顶')
    expect(banner.textContent).toContain('阿明')          // 谁置顶的
    expect(banner.textContent).toContain('幸福路9号')      // 置顶内容预览
    // 点横幅 → 跳到原消息（jsdom stub 的 scrollIntoView 被调用）。
    const jumpBtn = banner.querySelector('button[aria-label*="置顶消息"]') as HTMLButtonElement
    fireEvent.click(jumpBtn)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('点横幅 X → api.unpinMessage(置顶消息 id)，横幅消失（服务端随后回 pinned=null）', async () => {
    const msgs = [{ id: 'm1', fromId: 'p1', toId: 'me', kind: 'text', text: '钉住的话', createdAt: 1000 }]
    mock(api.messagesWith).mockResolvedValue({ messages: msgs, pinned: { id: 'm1', fromId: 'p1', toId: 'me', kind: 'text', text: '钉住的话', createdAt: 1000, pinnedByName: '阿明' } })
    // 真实语义：取消后服务端不再回 pinned → 让 unpin 之后的轮询回 pinned=null（否则 load 会把 mock 的置顶又拉回来）。
    mock(api.unpinMessage).mockImplementation(async () => { mock(api.messagesWith).mockResolvedValue({ messages: msgs, pinned: null }) })
    render(<ChatPage />)
    const banner = await screen.findByTestId('pinned-banner')
    fireEvent.click(within(banner).getByRole('button', { name: '取消置顶' })) // 横幅内的 X（气泡里也有"取消置顶"，须限定横幅内）
    await waitFor(() => expect(api.unpinMessage).toHaveBeenCalledWith('m1'))
    await waitFor(() => expect(screen.queryByTestId('pinned-banner')).toBeNull()) // 取消后横幅消失
  })

  it('无 pinned → 不渲染横幅；气泡菜单"置顶"→ api.pinMessage(该消息 id)', async () => {
    mock(api.messagesWith).mockResolvedValue({
      messages: [{ id: 'm2', fromId: 'p1', toId: 'me', kind: 'text', text: '普通消息', createdAt: 2000 }],
      pinned: null,
    })
    render(<ChatPage />)
    await screen.findByText('普通消息')
    expect(screen.queryByTestId('pinned-banner')).toBeNull()  // 无置顶不显横幅
    fireEvent.click(screen.getByRole('button', { name: '置顶' })) // 气泡菜单置顶入口
    await waitFor(() => expect(api.pinMessage).toHaveBeenCalledWith('m2'))
  })
})
