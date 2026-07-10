// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 无 peerId → 不自动进会话 → 展示会话**列表**（本测的对象是列表搜索过滤，非线程）。
vi.mock('react-router-dom', () => ({ useParams: () => ({}), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  api: { conversations: vi.fn(), groups: vi.fn(), searchAllMessages: vi.fn(), messagesWith: vi.fn(), markRead: vi.fn() },
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
    mock(api.searchAllMessages).mockResolvedValue({ messages: [] }) // 默认无消息命中；具体用例覆写
    mock(api.messagesWith).mockResolvedValue({ messages: [] })
    mock(api.markRead).mockResolvedValue({})
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

  it('全局消息命中：搜正文出现"消息"区（单聊按对端名、群按群名），点击直达对应会话；解析不到的命中不渲染', async () => {
    mock(api.searchAllMessages).mockResolvedValue({ messages: [
      { id: 'm1', fromId: 'p1', toId: 'me', kind: 'text', text: '医院地址是幸福路1号', createdAt: 1000 },      // 单聊 → 阿明
      { id: 'm2', fromId: 'me', toId: '', groupId: 'g1', kind: 'text', text: '群里说地址改了', createdAt: 2000 }, // 群 → 家庭群
      { id: 'm3', fromId: 'ghost', toId: 'me', kind: 'text', text: '幽灵地址', createdAt: 3000 },               // 对端不在会话列表 → 不渲染
    ] })
    render(<ChatPage />)
    await screen.findByText('阿明')
    fireEvent.change(search(), { target: { value: '地址' } })
    // 防抖 0.35s 后调全局搜索并渲染"消息"区。
    await waitFor(() => expect(api.searchAllMessages).toHaveBeenCalledWith('地址'))
    expect(await screen.findByText('医院地址是幸福路1号')).toBeInTheDocument()
    expect(screen.getByText('群里说地址改了')).toBeInTheDocument()
    expect(screen.queryByText('幽灵地址')).not.toBeInTheDocument() // 解析不到会话 → 不渲染死行
    // 点击单聊命中 → 打开与阿明的会话（Thread 拉取该对端消息）。
    fireEvent.click(screen.getByRole('button', { name: '打开与 阿明 的会话' }))
    await waitFor(() => expect(api.messagesWith).toHaveBeenCalledWith('p1', undefined, undefined))
  })

  it('全局命中：对端已注销（服务端空名）→ 命中行本地化为"已注销用户"、aria-label 完整（不留空名/残缺短语）', async () => {
    mock(api.conversations).mockResolvedValue({ conversations: [
      { peer: { id: 'p9', displayName: '', avatar: null }, last: null, unread: 0 }, // 已注销：服务端下发空 displayName
    ] })
    mock(api.searchAllMessages).mockResolvedValue({ messages: [
      { id: 'm9', fromId: 'p9', toId: 'me', kind: 'text', text: '之前发的地址', createdAt: 1000 },
    ] })
    render(<ChatPage />)
    await screen.findByText('已注销用户') // 会话列表本身也本地化（items 收口）
    fireEvent.change(search(), { target: { value: '地址' } })
    await waitFor(() => expect(api.searchAllMessages).toHaveBeenCalledWith('地址'))
    expect(await screen.findByText('之前发的地址')).toBeInTheDocument()
    // 命中行标题与 aria-label 都是"已注销用户"，非空名（修 hitTarget 绕开 items 本地化的缺口）。
    expect(screen.getByRole('button', { name: '打开与 已注销用户 的会话' })).toBeInTheDocument()
  })

  it('查询不足 2 字（如"红"）不触发全局搜索（防每键一请求）', async () => {
    render(<ChatPage />)
    await screen.findByText('阿明')
    fireEvent.change(search(), { target: { value: '红' } })
    await waitFor(() => expect(screen.queryByText('阿明')).not.toBeInTheDocument()) // 名字过滤照常生效
    await new Promise((r) => setTimeout(r, 450)) // 越过防抖窗口
    expect(api.searchAllMessages).not.toHaveBeenCalled()
  })
})
