// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 经 /chat/:peerId 预选单聊，验证"就地举报对方"入口（骚扰常发生在聊天里，不必进联系人页/通话中才能举报）。
vi.mock('react-router-dom', () => ({ useParams: () => ({ peerId: 'p1' }), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  SEARCH_LIMIT: 50, GLOBAL_SEARCH_LIMIT: 20, // Chat 搜索截断标注用常量（与真实 api.ts 同值）
  api: {
    conversations: vi.fn(), groups: vi.fn(), messagesWith: vi.fn(), markRead: vi.fn(),
    lookupUser: vi.fn(), familyLinks: vi.fn(), searchMessages: vi.fn(), report: vi.fn(),
  },
  APIError: class extends Error { code = ''; status = 0 },
  chatErrorText: () => 'err',
  callErrorText: () => 'err',
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('单聊就地举报', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    mock(api.groups).mockResolvedValue({ groups: [] })
    mock(api.markRead).mockResolvedValue({})
    mock(api.lookupUser).mockResolvedValue({ user: null })
    mock(api.familyLinks).mockResolvedValue({ links: [] })
    mock(api.messagesWith).mockResolvedValue({ messages: [] })
    mock(api.conversations).mockResolvedValue({ conversations: [{ peer: { id: 'p1', displayName: '阿明', avatar: null }, last: { id: 'm', fromId: 'p1', toId: 'me', kind: 'text', text: '嗨', createdAt: 1000 }, unread: 0, muted: false }] })
    mock(api.report).mockResolvedValue({})
  })

  it('单聊头部有"举报"入口；打开弹层提交只带对端 id+理由（无 callId/证据）', async () => {
    render(<ChatPage />)
    const btn = await screen.findByTestId('report-open')
    fireEvent.click(btn)
    // 举报弹层打开：填理由 + 提交 → api.report('p1', 理由, callId=undefined, evidence=undefined)。
    fireEvent.change(await screen.findByPlaceholderText(/请描述问题|Describe the issue/), { target: { value: '骚扰' } })
    fireEvent.click(screen.getByText(/提交举报|Submit report/))
    await waitFor(() => expect(api.report).toHaveBeenCalledWith('p1', '骚扰', undefined, undefined))
  })
})
