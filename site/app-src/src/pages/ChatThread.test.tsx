// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 经 /chat/:peerId 预选打开 Thread：mock useParams 给 peerId、useSession 给本人、api 给会话+消息。
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
const msg = (over: Record<string, unknown>) => ({ id: 'm', fromId: 'p1', toId: 'me', kind: 'text', text: '', createdAt: 1000, ...over })

describe('ChatPage 线程消息气泡渲染（防字段漂移：按 kind 渲染内容）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn() // jsdom 未实现；Thread 新消息自动滚到底会调用它
    mock(api.conversations).mockResolvedValue({ conversations: [{ peer: { id: 'p1', displayName: '阿明', avatar: null }, last: null, unread: 0 }] })
    mock(api.groups).mockResolvedValue({ groups: [] })
    mock(api.markRead).mockResolvedValue({})
    mock(api.lookupUser).mockResolvedValue({ user: null })   // 预选走 conversations 路径，不靠 lookup
    mock(api.familyLinks).mockResolvedValue({ links: [] })
  })

  it('文本→原文；recalled→"该消息已撤回"；image→<img alt>；audio→带 aria-label（读屏可知是语音消息）', async () => {
    mock(api.messagesWith).mockResolvedValue({
      messages: [
        msg({ id: 'm1', kind: 'text', text: '你好啊', createdAt: 1000 }),
        msg({ id: 'm2', kind: 'recalled', text: '', createdAt: 2000 }),
        msg({ id: 'm3', kind: 'image', text: 'data:image/png;base64,AAAA', createdAt: 3000 }),
        msg({ id: 'm4', kind: 'audio', text: 'data:audio/webm;base64,AAAA', createdAt: 4000 }),
      ],
    })
    render(<ChatPage />)
    expect(await screen.findByText('你好啊')).toBeInTheDocument()        // 文本原文
    expect(screen.getByText('该消息已撤回')).toBeInTheDocument()         // recalled
    expect(screen.getByAltText('图片消息')).toBeInTheDocument()          // image alt（本会话修过 alt=""）
    expect(screen.getByLabelText('语音消息')).toBeInTheDocument()        // audio aria-label（无障碍：读屏念得出是语音消息）
    // 输入端限长与后端(text≤4000)一致，避免超长发出后才被拒。
    expect((screen.getByPlaceholderText('输入消息…') as HTMLInputElement).maxLength).toBe(4000)
  })

  it('已读回执（与 iOS 对齐）：自己发的单聊 readAt 有→已读、无→已送达；对端消息与撤回不显示回执', async () => {
    mock(api.messagesWith).mockResolvedValue({
      messages: [
        msg({ id: 'r1', fromId: 'me', toId: 'p1', kind: 'text', text: '我到家了', createdAt: 1000, readAt: 1500 }), // 已读
        msg({ id: 'r2', fromId: 'me', toId: 'p1', kind: 'text', text: '在吗', createdAt: 2000 }),                    // 已送达（无 readAt）
        msg({ id: 'r3', fromId: 'p1', toId: 'me', kind: 'text', text: '在的', createdAt: 3000, readAt: 3500 }),      // 对端消息：不显示回执
        msg({ id: 'r4', fromId: 'me', toId: 'p1', kind: 'recalled', text: '', createdAt: 4000 }),                    // 自己撤回：不显示回执
      ],
    })
    render(<ChatPage />)
    await screen.findByText('我到家了')
    expect(screen.getAllByText('已读')).toHaveLength(1)     // 仅 r1（对端 r3 虽 readAt 有也不显示回执）
    expect(screen.getAllByText('已送达')).toHaveLength(1)   // 仅 r2
  })

  it('自己近期文字消息可编辑：点"编辑"→改文→保存调 editMessage；带 editedAt 显示"已编辑"', async () => {
    const now = Date.now()
    mock(api.editMessage).mockResolvedValue({ message: {} })
    mock(api.messagesWith).mockResolvedValue({
      messages: [
        msg({ id: 'e1', fromId: 'me', toId: 'p1', kind: 'text', text: '打错的字', createdAt: now }),                    // 近期自己发 → 可编辑
        msg({ id: 'e2', fromId: 'me', toId: 'p1', kind: 'text', text: '改过了', createdAt: now, editedAt: now }),        // 已编辑标记
        msg({ id: 'e3', fromId: 'p1', toId: 'me', kind: 'text', text: '对端消息', createdAt: now }),                     // 对端消息 → 无编辑按钮
      ],
    })
    render(<ChatPage />)
    await screen.findByText('打错的字')
    expect(screen.getAllByTestId('edited-tag')).toHaveLength(1)  // 仅 e2 标"已编辑"
    // 自己的两条可编辑（e1/e2），对端 e3 不可 → 恰两个"编辑"按钮。
    const editBtns = screen.getAllByText('编辑')
    expect(editBtns).toHaveLength(2)
    fireEvent.click(editBtns[0])                                 // 编辑 e1
    const box = await screen.findByTestId('edit-box')
    fireEvent.change(box.querySelector('textarea')!, { target: { value: '打对的字' } })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(api.editMessage).toHaveBeenCalledWith('e1', '打对的字'))
  })

  it('引用回复：被引消息已加载→气泡显示引用预览；点"回复"→回复栏；发送带 replyTo', async () => {
    const now = Date.now()
    mock(api.sendMessage).mockResolvedValue({ message: {} })
    mock(api.messagesWith).mockResolvedValue({
      messages: [
        msg({ id: 'orig', fromId: 'p1', toId: 'me', kind: 'text', text: '原始内容', createdAt: now }),
        msg({ id: 'rep', fromId: 'me', toId: 'p1', kind: 'text', text: '我的回复', createdAt: now + 1, replyTo: 'orig' }),
      ],
    })
    render(<ChatPage />)
    await screen.findByText('我的回复')
    // 引用预览渲染（含被引消息内容）。
    expect(screen.getByTestId('quoted')).toHaveTextContent('原始内容')
    // 点第一条消息的"回复" → 出现回复栏。
    fireEvent.click(screen.getAllByText('回复')[0])
    expect(await screen.findByTestId('reply-bar')).toBeInTheDocument()
    // 输入并回车发送 → sendMessage 第 4 参（replyTo）为被引消息 id。
    const input = screen.getByLabelText('输入消息')
    fireEvent.change(input, { target: { value: '收到啦' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled())
    expect(mock(api.sendMessage).mock.calls[0][3]).toBe('orig')
  })

  it('文本式位置消息在气泡里渲染为带坐标的位置链接（而非裸 maps URL）', async () => {
    mock(api.messagesWith).mockResolvedValue({
      messages: [msg({ id: 'm4', kind: 'text', text: '我在这 https://maps.apple.com/?ll=31.2,121.4&q=家', createdAt: 1000 })],
    })
    render(<ChatPage />)
    const loc = await screen.findByText(/家/)                              // 📍 家（解析出的地名）
    expect(loc.closest('a')?.getAttribute('href')).toContain('31.2')      // 链到地图、含坐标
    expect(screen.queryByText(/maps\.apple\.com/)).toBeNull()             // 不显示裸 URL
  })
})
