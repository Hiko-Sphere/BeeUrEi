// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// 经 /chat/:peerId 预选打开 Thread：mock useParams 给 peerId、useSession 给本人、api 给会话+消息。
vi.mock('react-router-dom', () => ({ useParams: () => ({ peerId: 'p1' }), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  api: {
    conversations: vi.fn(), groups: vi.fn(), messagesWith: vi.fn(), markRead: vi.fn(),
    lookupUser: vi.fn(), familyLinks: vi.fn(), searchMessages: vi.fn(),
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

  it('文本→原文；recalled→"该消息已撤回"；image→<img alt="图片消息">', async () => {
    mock(api.messagesWith).mockResolvedValue({
      messages: [
        msg({ id: 'm1', kind: 'text', text: '你好啊', createdAt: 1000 }),
        msg({ id: 'm2', kind: 'recalled', text: '', createdAt: 2000 }),
        msg({ id: 'm3', kind: 'image', text: 'data:image/png;base64,AAAA', createdAt: 3000 }),
      ],
    })
    render(<ChatPage />)
    expect(await screen.findByText('你好啊')).toBeInTheDocument()        // 文本原文
    expect(screen.getByText('该消息已撤回')).toBeInTheDocument()         // recalled
    expect(screen.getByAltText('图片消息')).toBeInTheDocument()          // image alt（本会话修过 alt=""）
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
