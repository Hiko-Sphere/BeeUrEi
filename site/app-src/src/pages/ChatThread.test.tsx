// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 经 /chat/:peerId 预选打开 Thread：mock useParams 给 peerId、useSession 给本人、api 给会话+消息。
vi.mock('react-router-dom', () => ({ useParams: () => ({ peerId: 'p1' }), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  SEARCH_LIMIT: 50, GLOBAL_SEARCH_LIMIT: 20, // Chat 搜索截断标注用常量（与真实 api.ts 同值）
  api: {
    conversations: vi.fn(), groups: vi.fn(), messagesWith: vi.fn(), markRead: vi.fn(),
    lookupUser: vi.fn(), familyLinks: vi.fn(), searchMessages: vi.fn(), editMessage: vi.fn(), sendMessage: vi.fn(),
    visionDescribe: vi.fn(),
  },
  APIError: class extends Error { code = ''; status = 0 },
  visionErrorText: (_e: unknown, t: (z: string, e: string) => string) => t('描述失败', 'Description failed'),
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

  it('图片消息「用 AI 描述」→ 调 visionDescribe 并显示描述（低视力家人网页端也能听懂图片，与 iOS 对齐）', async () => {
    mock(api.messagesWith).mockResolvedValue({
      messages: [msg({ id: 'm3', kind: 'image', text: 'data:image/png;base64,AAAA', createdAt: 3000 })],
    })
    mock(api.visionDescribe).mockResolvedValue({ text: '一只橘猫趴在窗台上', remaining: 9 })
    render(<ChatPage />)
    const btn = await screen.findByRole('button', { name: /用 AI 描述图片/ })
    fireEvent.click(btn)
    expect(await screen.findByText('一只橘猫趴在窗台上')).toBeInTheDocument()
    // 从 data URL 正确剥出 mime 送给端点（image/png），image 原样带前缀（服务端会剥）。
    // 泛描述：question(第4参)为 undefined（有值才是 VQA）；首轮无历史 → history(第5参)为 undefined。
    expect(api.visionDescribe).toHaveBeenCalledWith('data:image/png;base64,AAAA', 'image/png', expect.anything(), undefined, undefined)
  })

  it('图片消息「问」→ 把具体问题作为 question 参数发给 visionDescribe（图像问答 VQA）并显示答案', async () => {
    mock(api.messagesWith).mockResolvedValue({
      messages: [msg({ id: 'm3', kind: 'image', text: 'data:image/png;base64,AAAA', createdAt: 3000 })],
    })
    mock(api.visionDescribe).mockResolvedValue({ text: '电话号码是 138-0000-1234', remaining: 9 })
    render(<ChatPage />)
    const input = await screen.findByLabelText('向 AI 提问关于这张图片')
    fireEvent.change(input, { target: { value: '上面的电话号码是多少' } })
    fireEvent.click(screen.getByRole('button', { name: '问' }))
    expect(await screen.findByText('电话号码是 138-0000-1234')).toBeInTheDocument()
    // 第 4 参数=用户问题（VQA）；空问题不触发（按钮 disabled），此处非空。首轮无历史 → 第5参 undefined。
    expect(api.visionDescribe).toHaveBeenCalledWith('data:image/png;base64,AAAA', 'image/png', expect.anything(), '上面的电话号码是多少', undefined)
  })

  it('连续追问（对话式 VQA）：第二问把首轮 Q&A 作为 history 送上，模型据上下文答追问（对标 Be My AI）', async () => {
    mock(api.messagesWith).mockResolvedValue({
      messages: [msg({ id: 'm3', kind: 'image', text: 'data:image/png;base64,AAAA', createdAt: 3000 })],
    })
    mock(api.visionDescribe)
      .mockResolvedValueOnce({ text: '一盒饼干', remaining: 9 })
      .mockResolvedValueOnce({ text: '15 元', remaining: 8 })
    render(<ChatPage />)
    // 首轮：泛描述。
    fireEvent.click(await screen.findByRole('button', { name: /用 AI 描述图片/ }))
    expect(await screen.findByText('一盒饼干')).toBeInTheDocument()
    // 第二轮：追问"多少钱" → history 带首轮（泛描述记为默认问句 + 答"一盒饼干"）。
    const input = await screen.findByLabelText('继续向 AI 追问这张图片')
    fireEvent.change(input, { target: { value: '多少钱' } })
    fireEvent.click(screen.getByRole('button', { name: '问' }))
    expect(await screen.findByText('15 元')).toBeInTheDocument()
    expect(screen.getByText('一盒饼干')).toBeInTheDocument() // 首轮答案仍在（对话累积，非替换）
    expect(api.visionDescribe).toHaveBeenLastCalledWith('data:image/png;base64,AAAA', 'image/png', expect.anything(), '多少钱',
      [{ q: expect.any(String), a: '一盒饼干' }]) // 追问带首轮 history
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

  it('引用的原消息已翻出窗（首屏不含）→ 引用块仍可点，点击回翻页把原消息载入并高亮（修：此前占位不可点=跳不回早消息）', async () => {
    const now = Date.now()
    // 首屏（before 未定）只有回复本身、不含被引原消息；带 before 游标的回溯分页才返回原消息。
    mock(api.messagesWith).mockImplementation((_id: string, before?: number) =>
      Promise.resolve(before === undefined
        ? { messages: [msg({ id: 'rep', fromId: 'me', toId: 'p1', kind: 'text', text: '我的回复', createdAt: now, replyTo: 'orig' })] }
        : { messages: [msg({ id: 'orig', fromId: 'p1', toId: 'me', kind: 'text', text: '很早的原始内容', createdAt: now - 9_999_999 })] }))
    render(<ChatPage />)
    await screen.findByText('我的回复')
    // 原消息未加载 → 引用块显示"点击查看"占位，但**仍是可点按钮**（此前是死 div）。
    const quoted = screen.getByTestId('quoted')
    expect(quoted.tagName).toBe('BUTTON')
    expect(quoted).toHaveTextContent('引用的消息（点击查看）')
    fireEvent.click(quoted)
    // 回翻页把 orig 载入并高亮定位（否则回复较早消息时用户跳不回原文）。
    await waitFor(() => expect(document.getElementById('msg-orig')?.className ?? '').toContain('bg-honey/15'))
    expect(mock(api.messagesWith).mock.calls.some((c) => c[1] !== undefined)).toBe(true) // 确发过带游标的回溯请求
  })

  it('线程内搜索命中（已加载的消息）：点→关搜索并跳到高亮该条', async () => {
    const now = Date.now()
    mock(api.messagesWith).mockResolvedValue({
      messages: [
        msg({ id: 'hit', fromId: 'p1', toId: 'me', kind: 'text', text: '菜场在幸福路88号', createdAt: now }),
        msg({ id: 'other', fromId: 'me', toId: 'p1', kind: 'text', text: '好的', createdAt: now + 1 }),
      ],
    })
    mock(api.searchMessages).mockResolvedValue({
      messages: [msg({ id: 'hit', fromId: 'p1', toId: 'me', kind: 'text', text: '菜场在幸福路88号', createdAt: now })],
    })
    render(<ChatPage />)
    await screen.findByText('好的')
    fireEvent.click(screen.getByRole('button', { name: '搜索消息' }))        // 打开线程内搜索
    fireEvent.change(screen.getByPlaceholderText('搜索这个会话的文字消息'), { target: { value: '幸福路' } })
    const hit = await screen.findByTestId('search-hit')                      // 等去抖(350ms)+结果渲染
    fireEvent.click(hit)
    expect(document.getElementById('msg-hit')?.className).toContain('bg-honey/15') // 关搜索 + 跳到并高亮该条
    // 焦点移到目标消息（skip-link 范式）：搜索面板关闭后焦点若丢到 body，读屏用户"跳到了"却什么也听不到。
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('msg-hit')))
  })

  it('搜索命中很旧的消息（不在已加载窗口）→ 点击回溯分页把它载入并高亮定位（不再是死链）', async () => {
    const now = Date.now()
    const old = msg({ id: 'old', fromId: 'p1', toId: 'me', kind: 'text', text: '幸福路旧消息', createdAt: now - 9_999_999 })
    // 首屏（before 未定）只返回近两条；带 before 游标的**回溯分页**请求才返回那条很旧的命中。
    mock(api.messagesWith).mockImplementation((_id: string, before?: number) =>
      Promise.resolve(before === undefined
        ? { messages: [
            msg({ id: 'hit', fromId: 'p1', toId: 'me', kind: 'text', text: '菜场在幸福路88号', createdAt: now }),
            msg({ id: 'other', fromId: 'me', toId: 'p1', kind: 'text', text: '好的', createdAt: now + 1 }),
          ] }
        : { messages: [old] }))
    mock(api.searchMessages).mockResolvedValue({ messages: [old] }) // 服务端搜索命中的是很旧那条（正是搜索的意义）
    render(<ChatPage />)
    await screen.findByText('好的')
    expect(document.getElementById('msg-old')).toBeNull()                    // 旧消息初始不在已加载窗口
    fireEvent.click(screen.getByRole('button', { name: '搜索消息' }))
    fireEvent.change(screen.getByPlaceholderText('搜索这个会话的文字消息'), { target: { value: '幸福路' } })
    fireEvent.click(await screen.findByTestId('search-hit'))                 // 命中现在可点（旧行为是静态死链）
    // 回溯分页把旧消息载入 → 在上下文里高亮定位。
    await waitFor(() => expect(document.getElementById('msg-old')?.className ?? '').toContain('bg-honey/15'))
    expect(screen.getByText('幸福路旧消息')).toBeInTheDocument()             // 旧消息已进入消息列表
    expect(mock(api.messagesWith).mock.calls.some((c) => c[1] !== undefined)).toBe(true) // 确发过带游标的回溯请求
  })

  it('搜索结果打满上限(50)→如实标注"已显示最近 50 条匹配"；未打满→"找到 N 条"（no-silent-caps）', async () => {
    const now = Date.now()
    mock(api.messagesWith).mockResolvedValue({ messages: [msg({ id: 'm1', kind: 'text', text: '好的', createdAt: now })] })
    // 恰 50 条 = 服务端上限打满 → 可能还有更早的匹配被截断，不得说成"找到 50 条"。
    mock(api.searchMessages).mockResolvedValue({ messages: Array.from({ length: 50 }, (_, i) => msg({ id: `h${i}`, kind: 'text', text: `幸福路${i}号`, createdAt: now - i * 1000 })) })
    render(<ChatPage />)
    await screen.findByText('好的')
    fireEvent.click(screen.getByRole('button', { name: '搜索消息' }))
    fireEvent.change(screen.getByPlaceholderText('搜索这个会话的文字消息'), { target: { value: '幸福路' } })
    expect(await screen.findByText('已显示最近 50 条匹配，可能还有更早的')).toBeInTheDocument()
    expect(screen.queryByText('找到 50 条')).toBeNull()
    // 未打满（2 条）→ 照常"找到 2 条"（不对完整结果加多余含糊）。
    mock(api.searchMessages).mockResolvedValue({ messages: [
      msg({ id: 'h1', kind: 'text', text: '幸福路1号', createdAt: now }),
      msg({ id: 'h2', kind: 'text', text: '幸福路2号', createdAt: now - 1000 }),
    ] })
    fireEvent.change(screen.getByPlaceholderText('搜索这个会话的文字消息'), { target: { value: '幸福路真' } })
    expect(await screen.findByText('找到 2 条')).toBeInTheDocument()
  })

  it('语音消息发送侧接线：录制→结束 → sendMessage(kind=audio, data:audio/mp4;base64,…)（此前 web 只能收听不能回发）', async () => {
    // 桩 MediaRecorder（jsdom 无原生）：stop() 吐一块 audio/mp4 → onstop。navigator.mediaDevices 一并桩。
    class FakeRec {
      static isTypeSupported = (m: string) => m === 'audio/mp4'
      stream = { getTracks: () => [{ stop: vi.fn() }] }
      ondataavailable: ((e: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      state = 'inactive' // 真实语义：safeStop 只对 recording 态调 stop（无 state 的假会让守卫拒停、测试假红）
      start() { this.state = 'recording' }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['hi'], { type: 'audio/mp4' }) }); this.onstop?.() }
    }
    vi.stubGlobal('MediaRecorder', FakeRec)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) } })
    try {
      mock(api.sendMessage).mockResolvedValue({ message: {} })
      mock(api.messagesWith).mockResolvedValue({ messages: [msg({ id: 'm1', kind: 'text', text: '你好', createdAt: 1000 })] })
      render(<ChatPage />)
      await screen.findByText('你好')
      fireEvent.click(screen.getByLabelText('录制语音消息'))
      fireEvent.click(await screen.findByLabelText('结束并发送语音'))
      await waitFor(() => expect(api.sendMessage).toHaveBeenCalled())
      const [target, kind, body] = mock(api.sendMessage).mock.calls[0]
      expect(target).toEqual({ toId: 'p1' })                    // 发给当前对端
      expect(kind).toBe('audio')                                // 语音消息
      expect(String(body).startsWith('data:audio/mp4;base64,')).toBe(true) // AAC 家族（服务端只收此类、iOS 播得了）
    } finally { vi.unstubAllGlobals() }
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

  it('图片灯箱模态焦点：打开焦点入关闭键、关闭焦点回缩略图（proper aria-modal）', async () => {
    mock(api.messagesWith).mockResolvedValue({
      messages: [msg({ id: 'img1', fromId: 'p1', toId: 'me', kind: 'image', text: 'data:image/png;base64,AAAA', createdAt: Date.now() })],
    })
    render(<ChatPage />)
    const thumb = (await screen.findByAltText('图片消息')).closest('button')!
    thumb.focus()                                              // 模拟键盘/读屏聚焦到缩略图
    fireEvent.click(thumb)
    expect(document.activeElement).toBe(screen.getByLabelText('关闭')) // 打开 → 焦点入关闭键
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(thumb)                 // 关闭 → 焦点回缩略图（不丢到文档开头）
  })

  it('文本式位置消息在气泡里渲染为带坐标的位置链接（而非裸 maps URL）', async () => {
    mock(api.messagesWith).mockResolvedValue({
      messages: [msg({ id: 'm4', kind: 'text', text: '我在这 https://maps.apple.com/?ll=31.2,121.4&q=家', createdAt: 1000 })],
    })
    render(<ChatPage />)
    const loc = await screen.findByText(/家/)                              // 📍 家（解析出的地名）
    expect(loc.closest('a')?.getAttribute('href')).toContain('31.2')      // 链到地图、含坐标
    expect(screen.queryByText(/maps\.apple\.com/)).toBeNull()             // 不显示裸 URL
    // 「导航前往」：收到分享位置的家人常要赶去——一键导航链（daddr 方向），与位置页 SharingContactRow 同口径。
    const dir = screen.getByText('导航前往')
    expect(dir.getAttribute('href')).toContain('daddr=31.2')              // 导航链带目的地坐标
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
