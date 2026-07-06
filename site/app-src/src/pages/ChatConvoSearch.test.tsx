// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 无 peerId → 不自动进会话 → 展示会话**列表**（本测的对象是列表搜索过滤，非线程）。
vi.mock('react-router-dom', () => ({ useParams: () => ({}), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  api: { conversations: vi.fn(), groups: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const search = () => screen.getByLabelText('搜索会话') as HTMLInputElement

describe('ChatPage 会话列表按名字搜索过滤', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    mock(api.conversations).mockResolvedValue({ conversations: [
      { peer: { id: 'p1', displayName: '阿明', avatar: null }, last: null, unread: 0 },
      { peer: { id: 'p2', displayName: '小红', avatar: null }, last: null, unread: 0 },
    ] })
    mock(api.groups).mockResolvedValue({ groups: [
      { group: { id: 'g1', name: '家庭群', ownerId: 'me', createdAt: 1 }, members: [], last: null, unread: 0 },
    ] })
  })

  it('键入即缩到匹配项（单聊与群名都可搜）；清空恢复全部', async () => {
    render(<ChatPage />)
    // 初始三项全在。
    expect(await screen.findByText('阿明')).toBeInTheDocument()
    expect(screen.getByText('小红')).toBeInTheDocument()
    expect(screen.getByText('家庭群')).toBeInTheDocument()
    // 搜 "红" → 只剩小红。
    fireEvent.change(search(), { target: { value: '红' } })
    await waitFor(() => expect(screen.queryByText('阿明')).not.toBeInTheDocument())
    expect(screen.getByText('小红')).toBeInTheDocument()
    expect(screen.queryByText('家庭群')).not.toBeInTheDocument()
    // 搜 "家" → 群也能被搜到，其余隐藏。
    fireEvent.change(search(), { target: { value: '家' } })
    await waitFor(() => expect(screen.getByText('家庭群')).toBeInTheDocument())
    expect(screen.queryByText('小红')).not.toBeInTheDocument()
    // 清空 → 三项全回来。
    fireEvent.change(search(), { target: { value: '' } })
    await waitFor(() => expect(screen.getByText('阿明')).toBeInTheDocument())
    expect(screen.getByText('小红')).toBeInTheDocument()
    expect(screen.getByText('家庭群')).toBeInTheDocument()
  })

  it('无匹配 → 提示"没有匹配的会话"（而非空白误导为无会话）', async () => {
    render(<ChatPage />)
    await screen.findByText('阿明')
    fireEvent.change(search(), { target: { value: '查无此人zzz' } })
    await waitFor(() => expect(screen.getByText('没有匹配的会话')).toBeInTheDocument())
    // 搜索框仍在（用户可改词或清空），列表项都不在。
    expect(screen.queryByText('阿明')).not.toBeInTheDocument()
    expect(search()).toBeInTheDocument()
  })
})
