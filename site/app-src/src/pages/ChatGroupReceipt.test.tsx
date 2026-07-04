// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// 无 peerId → 不自动选单聊；测试点开群会话后验证「已读 N/总」群回执。
vi.mock('react-router-dom', () => ({ useParams: () => ({}), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  api: {
    conversations: vi.fn(), groups: vi.fn(), messagesWith: vi.fn(), groupMessages: vi.fn(),
    markRead: vi.fn(), markGroupRead: vi.fn(), lookupUser: vi.fn(), familyLinks: vi.fn(), searchMessages: vi.fn(),
  },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('群聊已读回执渲染（已读 N/其他成员数）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    mock(api.conversations).mockResolvedValue({ conversations: [] })
    mock(api.markGroupRead).mockResolvedValue({})
    mock(api.lookupUser).mockResolvedValue({ user: null })
    mock(api.familyLinks).mockResolvedValue({ links: [] })
    mock(api.groups).mockResolvedValue({
      groups: [{
        group: { id: 'g1', name: '家人群', ownerId: 'me', memberIds: ['me', 'p1', 'p2'], createdAt: 1000 },
        members: [{ id: 'me', displayName: '我' }, { id: 'p1', displayName: '阿明' }, { id: 'p2', displayName: '阿红' }],
        last: null, unread: 0,
      }],
    })
  })

  it('点开群 → 自己发的群消息显示「已读 1/2」；对端群消息不显示回执', async () => {
    mock(api.groupMessages).mockResolvedValue({
      messages: [
        { id: 'gm1', fromId: 'me', toId: '', groupId: 'g1', kind: 'text', text: '五点见', createdAt: 2000, readBy: 1, readTotal: 2 },
        { id: 'gm2', fromId: 'p1', toId: '', groupId: 'g1', kind: 'text', text: '好的', createdAt: 3000 },
      ],
    })
    render(<ChatPage />)
    // 点开群会话（侧栏群名）。
    fireEvent.click(await screen.findByText('家人群'))
    await screen.findByText('五点见')
    // 自己发的消息带群回执「已读 1/2」。
    const receipt = screen.getByTestId('group-receipt')
    expect(receipt).toHaveTextContent('已读 1/2')
    // 全部群回执只有一个（对端 gm2 不显示）。
    expect(screen.getAllByTestId('group-receipt')).toHaveLength(1)
  })

  it('全员已读（已读 2/2）加粗强调；readTotal 为 0（无其他成员）时不渲染回执', async () => {
    mock(api.groupMessages).mockResolvedValue({
      messages: [
        { id: 'gm1', fromId: 'me', toId: '', groupId: 'g1', kind: 'text', text: '都到齐了吗', createdAt: 2000, readBy: 2, readTotal: 2 },
        { id: 'gm2', fromId: 'me', toId: '', groupId: 'g1', kind: 'text', text: '空群自语', createdAt: 2500, readBy: 0, readTotal: 0 },
      ],
    })
    render(<ChatPage />)
    fireEvent.click(await screen.findByText('家人群'))
    await screen.findByText('都到齐了吗')
    // readTotal>0 的那条渲染回执；readTotal===0 的不渲染 → 恰一个。
    const receipts = screen.getAllByTestId('group-receipt')
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toHaveTextContent('已读 2/2')
    expect(receipts[0].className).toContain('font-medium') // 全员已读加粗
  })
})
