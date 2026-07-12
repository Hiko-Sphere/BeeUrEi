// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// 粘贴发图的**门禁**（confirm 防误发 / 纯文本不拦截）。完整压缩+发送管线复用既有 sendImage
//（canvas 在 jsdom 不可用，管线由真实浏览器路径与既有实现保障，此处测门禁行为本身）。
vi.mock('react-router-dom', () => ({ useParams: () => ({ peerId: 'p1' }), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  SEARCH_LIMIT: 50, GLOBAL_SEARCH_LIMIT: 20, // Chat 搜索截断标注用常量（与真实 api.ts 同值）
  api: {
    conversations: vi.fn(), groups: vi.fn(), messagesWith: vi.fn(), markRead: vi.fn(),
    lookupUser: vi.fn(), familyLinks: vi.fn(), searchAllMessages: vi.fn(), sendMessage: vi.fn(),
  },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const imageItem = { kind: 'file', type: 'image/png', getAsFile: () => new File(['x'], 'shot.png', { type: 'image/png' }) }
const textItem = { kind: 'string', type: 'text/plain', getAsFile: () => null }

describe('ChatPage 粘贴发图门禁', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    mock(api.conversations).mockResolvedValue({ conversations: [{ peer: { id: 'p1', displayName: '阿明', avatar: null }, last: null, unread: 0 }] })
    mock(api.groups).mockResolvedValue({ groups: [] })
    mock(api.messagesWith).mockResolvedValue({ messages: [] })
    mock(api.markRead).mockResolvedValue({})
    mock(api.searchAllMessages).mockResolvedValue({ messages: [] })
    mock(api.lookupUser).mockResolvedValue({ user: null })   // 首帧 convos 未到时的预选路径会打它
    mock(api.familyLinks).mockResolvedValue({ links: [] })
  })
  afterEach(() => vi.restoreAllMocks())

  it('粘贴图片 → 弹确认（防误发）；拒绝 → 不发送；事件被 preventDefault（不落进输入框）', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ChatPage />)
    const input = await screen.findByLabelText('输入消息')
    const notPrevented = fireEvent.paste(input, { clipboardData: { items: [imageItem] } })
    expect(confirmSpy).toHaveBeenCalledWith('发送剪贴板中的图片？')
    expect(notPrevented).toBe(false)                 // 有图：preventDefault（文件本就不该落进文本框）
    expect(api.sendMessage).not.toHaveBeenCalled()   // 用户拒绝 → 不发送
  })

  it('粘贴纯文本 → 不弹确认、不拦截（默认粘贴行为不受影响）', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ChatPage />)
    const input = await screen.findByLabelText('输入消息')
    const notPrevented = fireEvent.paste(input, { clipboardData: { items: [textItem] } })
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(notPrevented).toBe(true) // 未 preventDefault：文字照常粘贴
  })
})
