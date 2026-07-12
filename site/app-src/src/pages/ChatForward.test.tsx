// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-router-dom', () => ({ useParams: () => ({ peerId: 'p1' }), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  api: {
    conversations: vi.fn(), groups: vi.fn(), messagesWith: vi.fn(), markRead: vi.fn(),
    lookupUser: vi.fn(), familyLinks: vi.fn(), searchMessages: vi.fn(), sendMessage: vi.fn(),
  },
  APIError: class extends Error { code = ''; status = 0 },
  chatErrorText: () => 'err',
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const msg = (over: Record<string, unknown>) => ({ id: 'm', fromId: 'p1', toId: 'me', kind: 'text', text: '', createdAt: 1000, ...over })

describe('消息转发', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    mock(api.conversations).mockResolvedValue({ conversations: [{ peer: { id: 'p1', displayName: '阿明', avatar: null }, last: null, unread: 0 }, { peer: { id: 'p2', displayName: '阿红', avatar: null }, last: null, unread: 0 }] })
    mock(api.groups).mockResolvedValue({ groups: [] })
    mock(api.markRead).mockResolvedValue({})
    mock(api.lookupUser).mockResolvedValue({ user: null })
    mock(api.familyLinks).mockResolvedValue({ links: [] })
  })

  it('点"转发"→选目标→sendMessage 带 forwarded=true 重发消息内容', async () => {
    mock(api.sendMessage).mockResolvedValue({ message: {} })
    mock(api.messagesWith).mockResolvedValue({ messages: [msg({ id: 'm1', kind: 'text', text: '会议改到五点' })] })
    render(<ChatPage />)
    await screen.findByText('会议改到五点')
    fireEvent.click(screen.getByText('转发'))
    // 目标选择器出现，选第一个会话（阿明）。
    const targets = await screen.findAllByTestId('forward-target')
    fireEvent.click(targets[0])
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled())
    const call = mock(api.sendMessage).mock.calls[0]
    expect(call[1]).toBe('text')          // 保持原 kind
    expect(call[2]).toBe('会议改到五点')   // 原内容
    expect(call[4]).toBe(true)            // forwarded 标记
  })

  it('可转发给尚无会话历史的联系人（不止"有过消息的会话"）；与会话去重、pending 不列', async () => {
    mock(api.sendMessage).mockResolvedValue({ message: {} })
    mock(api.messagesWith).mockResolvedValue({ messages: [msg({ id: 'm1', kind: 'text', text: '会议改到五点' })] })
    // 会话里只有 p1；联系人里有 p1（应去重）、p3（还没聊过，应可选）、p4（pending 不能收发，不列）。
    mock(api.conversations).mockResolvedValue({ conversations: [{ peer: { id: 'p1', displayName: '阿明', avatar: null }, last: null, unread: 0 }] })
    mock(api.familyLinks).mockResolvedValue({ links: [
      { id: 'l1', memberId: 'p1', memberName: '阿明', relation: '朋友', isEmergency: false, status: 'accepted' },
      { id: 'l3', memberId: 'p3', memberName: '阿伟', relation: '同事', isEmergency: false, status: 'accepted' },
      { id: 'l4', memberId: 'p4', memberName: '待接受', relation: '', isEmergency: false, status: 'pending' },
    ] })
    render(<ChatPage />)
    await screen.findByText('会议改到五点')
    fireEvent.click(screen.getByText('转发'))
    const targets = await screen.findAllByTestId('forward-target')
    expect(targets).toHaveLength(2)                          // p1(会话) + p3(联系人无会话)；p1 不重复、pending p4 不列
    expect(screen.getByText('阿伟')).toBeInTheDocument()     // 还没聊过的联系人也能选作转发目标
    fireEvent.click(screen.getByText('阿伟'))
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled())
    expect(mock(api.sendMessage).mock.calls[0][0]).toEqual({ toId: 'p3' }) // 转发目标就是这位联系人
    expect(mock(api.sendMessage).mock.calls[0][4]).toBe(true)              // forwarded 标记
  })

  it('forwarded=true 的消息渲染「已转发」标注', async () => {
    mock(api.messagesWith).mockResolvedValue({ messages: [msg({ id: 'm2', kind: 'text', text: '这是转发来的', forwarded: true })] })
    render(<ChatPage />)
    await screen.findByText('这是转发来的')
    expect(screen.getByTestId('forwarded-tag')).toBeInTheDocument()
  })
})
