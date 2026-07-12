// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// 群深链 /chat/g/:groupId：useParams 给 groupId → ChatPage 应**无需点击**自动预选该群、打开 Thread
//（群消息 web push 点开直达该群，与单聊 /chat/:peerId 对称）。
vi.mock('react-router-dom', () => ({ useParams: () => ({ groupId: 'g1' }), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  SEARCH_LIMIT: 50, GLOBAL_SEARCH_LIMIT: 20, // Chat 搜索截断标注用常量（与真实 api.ts 同值）
  api: { conversations: vi.fn(), groups: vi.fn(), groupMessages: vi.fn(), markGroupRead: vi.fn(), searchMessages: vi.fn(), familyLinks: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('ChatPage 群深链 /chat/g/:groupId 预选', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn() // jsdom 未实现
    mock(api.conversations).mockResolvedValue({ conversations: [] })
    mock(api.markGroupRead).mockResolvedValue({})
    mock(api.familyLinks).mockResolvedValue({ links: [] })
  })

  it('URL 带 groupId → 无需点击即自动打开该群 Thread（群消息正文出现、群成员名渲染）', async () => {
    mock(api.groups).mockResolvedValue({
      groups: [{ group: { id: 'g1', name: '家庭群', ownerId: 'me', createdAt: 1000 }, members: [{ id: 'me', displayName: '我' }, { id: 'mem1', displayName: '小红' }], last: null, unread: 0 }],
    })
    mock(api.groupMessages).mockResolvedValue({
      messages: [{ id: 'gm1', fromId: 'mem1', toId: '', groupId: 'g1', kind: 'text', text: '大家好', createdAt: 2000 }],
    })
    render(<ChatPage />)
    // 未点击任何元素：Thread 因 URL groupId 自动打开 → 群消息正文出现。
    expect(await screen.findByText('大家好')).toBeInTheDocument()
    expect(screen.getByText('小红')).toBeInTheDocument()   // 群成员发送者名（确认是群 Thread、成员表已带入 sel）
    expect(api.groupMessages).toHaveBeenCalled()           // 预选生效 → 确实加载了该群消息
  })

  it('groupId 指向我不在/已退的群（groups 里没有）→ 不预选、不拉群消息、页面不崩', async () => {
    mock(api.groups).mockResolvedValue({ groups: [] }) // 无 g1
    mock(api.groupMessages).mockResolvedValue({ messages: [] })
    render(<ChatPage />)
    await waitFor(() => expect(api.groups).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0)) // flush 预选 effect（依赖 groups 到达后）
    expect(api.groupMessages).not.toHaveBeenCalled()   // 未选到群 → 不加载群消息（无死链/无崩）
  })
})
