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
import { axeViolations } from '../lib/axeCheck'

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

  it('文本里的 http(s) 链接渲染为可点链接（rel 含 noopener）；周围文本仍在', async () => {
    mock(api.messagesWith).mockResolvedValue({
      messages: [msg({ id: 'lk1', kind: 'text', text: '看这个 https://example.com/x 挺好', createdAt: 1000 })],
    })
    render(<ChatPage />)
    const link = await screen.findByRole('link', { name: 'https://example.com/x' })
    expect(link).toHaveAttribute('href', 'https://example.com/x')
    expect(link.getAttribute('rel') ?? '').toContain('noopener')     // 防标签劫持
    expect(screen.getAllByText(/看这个/).length).toBeGreaterThan(0)  // 非链接文本仍是纯文本（外层+内层 span 均含）
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

  it('点引用预览 → 跳到并短暂高亮原消息（IM 标配：回看长对话不必手翻找被引那条）', async () => {
    const now = Date.now()
    mock(api.messagesWith).mockResolvedValue({
      messages: [
        msg({ id: 'orig', fromId: 'p1', toId: 'me', kind: 'text', text: '原始内容', createdAt: now }),
        msg({ id: 'rep', fromId: 'me', toId: 'p1', kind: 'text', text: '我的回复', createdAt: now + 1, replyTo: 'orig' }),
      ],
    })
    render(<ChatPage />)
    await screen.findByText('我的回复')
    // 原消息容器点前未高亮。
    expect(document.getElementById('msg-orig')?.className ?? '').not.toContain('bg-honey/15')
    // 引用预览此时是可点按钮（原消息已加载）→ 点击跳转 + 高亮原消息。
    fireEvent.click(screen.getByTestId('quoted'))
    expect(document.getElementById('msg-orig')?.className).toContain('bg-honey/15')
  })

  it('线程内搜索命中：已加载的消息可点→关搜索并跳到高亮该条；未加载的命中静态不可点', async () => {
    const now = Date.now()
    mock(api.messagesWith).mockResolvedValue({
      messages: [
        msg({ id: 'hit', fromId: 'p1', toId: 'me', kind: 'text', text: '菜场在幸福路88号', createdAt: now }),
        msg({ id: 'other', fromId: 'me', toId: 'p1', kind: 'text', text: '好的', createdAt: now + 1 }),
      ],
    })
    mock(api.searchMessages).mockResolvedValue({
      messages: [
        msg({ id: 'hit', fromId: 'p1', toId: 'me', kind: 'text', text: '菜场在幸福路88号', createdAt: now }),          // 已加载 → 可跳
        msg({ id: 'old', fromId: 'p1', toId: 'me', kind: 'text', text: '幸福路旧消息', createdAt: now - 9_999_999 }), // 未加载 → 静态
      ],
    })
    render(<ChatPage />)
    await screen.findByText('好的')
    fireEvent.click(screen.getByRole('button', { name: '搜索消息' }))        // 打开线程内搜索
    fireEvent.change(screen.getByPlaceholderText('搜索这个会话的文字消息'), { target: { value: '幸福路' } })
    const hits = await screen.findAllByTestId('search-hit')                  // 等去抖(350ms)+结果渲染
    expect(hits).toHaveLength(1)                                             // 仅已加载的 hit 可点；old 未加载→静态无 testid
    fireEvent.click(hits[0])
    expect(document.getElementById('msg-hit')?.className).toContain('bg-honey/15') // 关搜索 + 跳到并高亮该条
  })

  it('打开有未读的会话 → "新消息"分隔线落在第一条未读对端消息前', async () => {
    const now = Date.now()
    mock(api.conversations).mockResolvedValue({ conversations: [{ peer: { id: 'p1', displayName: '阿明', avatar: null }, last: null, unread: 2 }] })
    mock(api.messagesWith).mockResolvedValue({
      messages: [
        msg({ id: 'old', fromId: 'p1', toId: 'me', kind: 'text', text: '早已读的旧消息', createdAt: now - 100 }),
        msg({ id: 'u1', fromId: 'p1', toId: 'me', kind: 'text', text: '未读一', createdAt: now }),
        msg({ id: 'u2', fromId: 'p1', toId: 'me', kind: 'text', text: '未读二', createdAt: now + 1 }),
      ],
    })
    render(<ChatPage />)
    await screen.findByText('未读二')
    const divider = await screen.findByTestId('unread-divider')
    // 未读=2 → 分隔线在 u1 前（末尾往前数 2 条对端消息 u2、u1 里最早的 u1）：落 msg-u1 容器内、不在 old。
    expect(document.getElementById('msg-u1')?.contains(divider)).toBe(true)
    expect(document.getElementById('msg-old')?.contains(divider)).toBe(false)
    // 打开即乐观清列表未读徽标：正在看的会话不再显未读徽标（去 stale）。
    expect(screen.queryByTestId('convo-unread')).toBeNull()
  })

  it('图片消息可点开全屏灯箱看大图；关闭按钮 / Esc 关灯箱', async () => {
    mock(api.messagesWith).mockResolvedValue({
      messages: [msg({ id: 'img1', fromId: 'p1', toId: 'me', kind: 'image', text: 'data:image/png;base64,AAAA', createdAt: Date.now() })],
    })
    render(<ChatPage />)
    const thumb = await screen.findByAltText('图片消息')      // 缩略图（点开前仅此一张）
    expect(screen.queryByTestId('image-lightbox')).toBeNull() // 初始无灯箱
    fireEvent.click(thumb.closest('button')!)                 // 点缩略图 → 开灯箱
    expect(screen.getByTestId('image-lightbox')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('关闭'))            // 关闭按钮 → 关
    expect(screen.queryByTestId('image-lightbox')).toBeNull()
    fireEvent.click(thumb.closest('button')!)                 // 再开 → Esc 关
    expect(screen.getByTestId('image-lightbox')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('image-lightbox')).toBeNull()
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

  it('发送我的位置：点定位按钮→取浏览器坐标→发出 📍 位置文本(kind=text，与 iOS 同口径)', async () => {
    mock(api.messagesWith).mockResolvedValue({ messages: [] })
    mock(api.sendMessage).mockResolvedValue({})
    // 桩 geolocation：成功回调给定坐标（jsdom 无 geolocation，需自备）。
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) => ok({ coords: { latitude: 31.23, longitude: 121.47 } }) },
    })
    render(<ChatPage />)
    fireEvent.click(await screen.findByLabelText('发送我的位置'))
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled())
    const [target, kind, body] = mock(api.sendMessage).mock.calls[0]
    expect(target).toEqual({ toId: 'p1' })   // 发给当前对端
    expect(kind).toBe('text')                 // 与 iOS 同口径：kind=text 内嵌链接
    expect(body).toContain('📍')
    expect(body).toContain('maps.apple.com/?ll=31.230000,121.470000') // 6 位小数
  })

  it('会话头显示对端在线态（WhatsApp 式）：online:true→头部现"在线"；online:false→不现', async () => {
    mock(api.messagesWith).mockResolvedValue({ messages: [msg({ id: 'm1', kind: 'text', text: 'hi', createdAt: 1000 })] })
    // 在线：会话带 online:true → 打开会话头部出现"在线"。
    mock(api.conversations).mockResolvedValue({ conversations: [{ peer: { id: 'p1', displayName: '阿明', avatar: null }, last: null, unread: 0, online: true }] })
    const { unmount } = render(<ChatPage />)
    expect(await screen.findByText('hi')).toBeInTheDocument()  // Thread 已挂载
    expect(screen.getByText('在线')).toBeInTheDocument()       // 头部在线态
    unmount()
    // 离线：同一对端 online:false → 头部无"在线"。
    mock(api.conversations).mockResolvedValue({ conversations: [{ peer: { id: 'p1', displayName: '阿明', avatar: null }, last: null, unread: 0, online: false }] })
    render(<ChatPage />)
    expect(await screen.findByText('hi')).toBeInTheDocument()
    expect(screen.queryByText('在线')).toBeNull()
  })

  // 无障碍门禁（axe）：聊天会话页含本会话新增的"发送我的位置"按钮、在线圆点/会话头在线态,
  // 以及录入区（附件/输入/发送）——全是服务视障用户的交互控件,须 0 违规。
  it('会话页 axe 0 违规（在线头 + 发送位置/附件/输入/发送按钮均有可及名）', async () => {
    mock(api.messagesWith).mockResolvedValue({ messages: [msg({ id: 'm1', kind: 'text', text: '你好', createdAt: 1000 })] })
    mock(api.conversations).mockResolvedValue({ conversations: [{ peer: { id: 'p1', displayName: '阿明', avatar: null }, last: null, unread: 0, online: true }] })
    const { container } = render(<ChatPage />)
    await screen.findByText('你好')                       // 线程已挂载
    await screen.findByLabelText('发送我的位置')          // 位置按钮已渲染
    expect(await axeViolations(container)).toEqual([])
  })
})
