// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 打开与 p1 的单聊：mock useParams 给 peerId、useSession 给本人(me)、api 给会话+消息。
vi.mock('react-router-dom', () => ({ useParams: () => ({ peerId: 'p1' }), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
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
