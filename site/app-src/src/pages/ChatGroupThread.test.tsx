// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// 群聊无 /chat/:id 预选，需点列表里的群行打开 Thread。useParams 给空。
vi.mock('react-router-dom', () => ({ useParams: () => ({}), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  SEARCH_LIMIT: 50, GLOBAL_SEARCH_LIMIT: 20, // Chat 搜索截断标注用常量（与真实 api.ts 同值）
  api: { conversations: vi.fn(), groups: vi.fn(), groupMessages: vi.fn(), markGroupRead: vi.fn(), searchMessages: vi.fn(), familyLinks: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('ChatPage 群聊气泡发送者名（防字段漂移：从 sel.members 查 displayName）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn() // jsdom 未实现
    mock(api.conversations).mockResolvedValue({ conversations: [] })
    mock(api.markGroupRead).mockResolvedValue({})
    mock(api.familyLinks).mockResolvedValue({ links: [] })
  })

  it('点开群聊 → 他人消息显示发送者昵称（取自群成员表）', async () => {
    mock(api.groups).mockResolvedValue({
      groups: [{ group: { id: 'g1', name: '家庭群', ownerId: 'me', createdAt: 1000 }, members: [{ id: 'me', displayName: '我' }, { id: 'mem1', displayName: '小红' }], last: null, unread: 0 }],
    })
    mock(api.groupMessages).mockResolvedValue({
      messages: [{ id: 'gm1', fromId: 'mem1', toId: '', groupId: 'g1', kind: 'text', text: '大家好', createdAt: 2000 }],
    })
    render(<ChatPage />)
    fireEvent.click(await screen.findByText('家庭群'))     // 点群行打开 Thread
    expect(await screen.findByText('大家好')).toBeInTheDocument()  // 群消息正文
    expect(screen.getByText('小红')).toBeInTheDocument()           // 发送者昵称（members 查得；非 fromId）
  })
})
