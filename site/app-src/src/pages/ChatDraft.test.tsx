// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// 打开与 p1 的单聊：mock useParams 给 peerId、useSession 给本人(me)、api 给会话+消息。
vi.mock('react-router-dom', () => ({ useParams: () => ({ peerId: 'p1' }), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  SEARCH_LIMIT: 50, GLOBAL_SEARCH_LIMIT: 20, // Chat 搜索截断标注用常量（与真实 api.ts 同值）
  api: {
    conversations: vi.fn(), groups: vi.fn(), messagesWith: vi.fn(), markRead: vi.fn(),
    lookupUser: vi.fn(), familyLinks: vi.fn(), searchMessages: vi.fn(), editMessage: vi.fn(), sendMessage: vi.fn(),
  },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const PLACEHOLDER = '输入消息…'
const input = () => screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement

// 未发送草稿按会话持久化（切会话/刷新/误触返回不丢）——读屏/键盘输入更慢，丢草稿代价更高。
describe('ChatPage 会话草稿本地持久化', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
    mock(api.conversations).mockResolvedValue({ conversations: [{ peer: { id: 'p1', displayName: '阿明', avatar: null }, last: null, unread: 0 }] })
    mock(api.groups).mockResolvedValue({ groups: [] })
    mock(api.messagesWith).mockResolvedValue({ messages: [] })
    mock(api.markRead).mockResolvedValue({})
    mock(api.lookupUser).mockResolvedValue({ user: null })
    mock(api.familyLinks).mockResolvedValue({ links: [] })
  })

  it('输入即写本地草稿（键按 当前用户+会话 命名空间，防换账号串读）', async () => {
    render(<ChatPage />)
    await screen.findByPlaceholderText(PLACEHOLDER)
    fireEvent.change(input(), { target: { value: '还没发出的半句话' } })
    // 草稿键含本人 id(me) 与会话(peer:p1)——换账号后前缀不同、绝不串读到别人的草稿。
    await waitFor(() => expect(localStorage.getItem('beeurei:draft:me:peer:p1')).toBe('还没发出的半句话'))
  })

  it('切走再回来（Thread 重挂载）→ 草稿回填输入框', async () => {
    const { unmount } = render(<ChatPage />)
    await screen.findByPlaceholderText(PLACEHOLDER)
    fireEvent.change(input(), { target: { value: '回家的路怎么走' } })
    await waitFor(() => expect(localStorage.getItem('beeurei:draft:me:peer:p1')).toBe('回家的路怎么走'))
    // 模拟离开会话再返回：整页卸载重挂（Thread 按会话 key 重挂载，惰性初始化读回草稿）。
    unmount()
    render(<ChatPage />)
    await screen.findByPlaceholderText(PLACEHOLDER)
    await waitFor(() => expect(input().value).toBe('回家的路怎么走'))
  })

  it('会话列表行显示"[草稿] …"（优先于末条消息预览，WhatsApp/Telegram 标配）；无草稿行不标', async () => {
    // 预置草稿（上次没写完就离开）+ 另一无草稿会话作对照。
    localStorage.setItem('beeurei:draft:me:peer:p1', '还没发完的话')
    mock(api.conversations).mockResolvedValue({ conversations: [
      { peer: { id: 'p1', displayName: '阿明', avatar: null }, last: null, unread: 0 },
      { peer: { id: 'p2', displayName: '小红', avatar: null }, last: { id: 'l1', fromId: 'p2', toId: 'me', kind: 'text', text: '上一条消息', createdAt: 1000 }, unread: 0 },
    ] })
    render(<ChatPage />)
    await screen.findByText('小红')
    // 限定在会话列表内找（"阿明"同时出现在自动进入的线程头，直接 getByText 会撞 multiple）。
    const list = screen.getByLabelText('会话列表')
    const mingRow = within(list).getByText('阿明').closest('li')!
    expect(mingRow.textContent).toContain('[草稿]')
    expect(mingRow.textContent).toContain('还没发完的话') // 草稿正文可见（不被末条消息盖住）
    const hongRow = within(list).getByText('小红').closest('li')!
    expect(hongRow.textContent).not.toContain('[草稿]')   // 无草稿：照常显示末条消息预览
    expect(hongRow.textContent).toContain('上一条消息')
  })

  it('发送成功后清空草稿键（不残留已发内容）', async () => {
    mock(api.sendMessage).mockResolvedValue({})
    render(<ChatPage />)
    await screen.findByPlaceholderText(PLACEHOLDER)
    fireEvent.change(input(), { target: { value: '我到楼下了' } })
    await waitFor(() => expect(localStorage.getItem('beeurei:draft:me:peer:p1')).toBe('我到楼下了'))
    // 回车发送 → setText('') → 草稿键被删除。
    fireEvent.keyDown(input(), { key: 'Enter' })
    await waitFor(() => expect(mock(api.sendMessage)).toHaveBeenCalled())
    await waitFor(() => expect(localStorage.getItem('beeurei:draft:me:peer:p1')).toBeNull())
  })
})
