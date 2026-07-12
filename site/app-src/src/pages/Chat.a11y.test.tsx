// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render } from '@testing-library/react'
import { axeViolations } from '../lib/axeCheck'

/// 聊天页无障碍门禁：Chat 是协助端**最高流量**页（会话列表 + 消息线程，满是图标按钮：发图/发位置/静音/举报/
/// 返回/表情回应/撤回/输入框），此前不在 axe 门禁内。渲染时同时挂出会话列表与线程（jsdom 无 CSS，md:hidden 也在
/// DOM），一次覆盖两大面。axe 配置见 lib/axeCheck.ts（color-contrast/region 因 jsdom 限制禁用，其余全效）。
/// 独立文件：自带 mock，不扰共享 a11y 门禁。

vi.mock('react-router-dom', () => ({
  useParams: () => ({ peerId: 'm1' }), // 深链单聊：同时渲染会话列表 + 该会话线程
  useNavigate: () => vi.fn(),
}))
vi.mock('../lib/poll', () => ({ pollWhileVisible: () => () => {} })) // 桩掉可见性轮询，门禁只审静态可访问性
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '阿明', role: 'helper' } }) }))
vi.mock('../lib/api', () => ({
  SEARCH_LIMIT: 50, GLOBAL_SEARCH_LIMIT: 20, // Chat 搜索截断标注用常量（与真实 api.ts 同值）
  api: {
    conversations: vi.fn(), groups: vi.fn(), messagesWith: vi.fn(), markRead: vi.fn(),
    // 动作方法（挂载不触发，存在即可）：
    sendMessage: vi.fn(), reactMessage: vi.fn(), recallMessage: vi.fn(), editMessage: vi.fn(),
    markGroupRead: vi.fn(), groupMessages: vi.fn(), muteConversation: vi.fn(), muteGroup: vi.fn(),
    searchAllMessages: vi.fn(), searchMessages: vi.fn(), lookupUser: vi.fn(), familyLinks: vi.fn(),
    createGroup: vi.fn(), addGroupMember: vi.fn(), renameGroup: vi.fn(), leaveGroup: vi.fn(), deleteGroup: vi.fn(),
  },
  chatErrorText: (_e: unknown, _t: unknown, fallback: string) => fallback,
  fetchMediaObjectURL: vi.fn(),
  uploadMedia: vi.fn(),
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

// jsdom 未实现 scrollIntoView（Chat 收到新消息滚到底部会调）——桩掉，不影响可访问性审计。
beforeAll(() => { window.HTMLElement.prototype.scrollIntoView = vi.fn() })

describe('Chat 页无障碍门禁（axe 0 violations）', () => {
  it('会话列表 + 单聊线程（消息气泡/表情回应/发图发位置/静音举报/输入框图标按钮）全程 0 violations', async () => {
    mock(api.conversations).mockResolvedValue({ conversations: [
      { peer: { id: 'm1', username: 'xiaoming', displayName: '小明', role: 'blind', status: 'active', avatar: null }, last: { id: 'l1', fromId: 'm1', toId: 'me', kind: 'text', text: '你好', createdAt: 1_700_000_000_000 }, unread: 2, muted: false, online: true },
    ] })
    mock(api.groups).mockResolvedValue({ groups: [] })
    mock(api.markRead).mockResolvedValue({})
    // 首帧 convos 为 null 时预选 effect 走 lookupUser 兜底路径（随后 convos 到达再由列表解析 sel）——须为 Promise。
    mock(api.lookupUser).mockResolvedValue({ user: null })
    mock(api.familyLinks).mockResolvedValue({ links: [] })
    mock(api.messagesWith).mockResolvedValue({ messages: [
      { id: 'msg1', fromId: 'm1', toId: 'me', kind: 'text', text: '能帮我看看这个快递单吗', createdAt: 1_700_000_000_000 },
      { id: 'msg2', fromId: 'me', toId: 'm1', kind: 'text', text: '好的，发给我', createdAt: 1_700_000_000_100, readAt: 1_700_000_000_200, reaction: '👍' },
    ] })

    const { container, findByText } = render(<ChatPage />)
    await findByText('能帮我看看这个快递单吗') // 等线程消息渲染完（含气泡/回应/操作按钮）再审
    await findByText('好的，发给我')
    expect(await axeViolations(container)).toEqual([])
  })
})

/// 键盘焦点可见（WCAG 2.4.7）：消息操作按钮（回应/回复/转发/编辑/撤回/置顶）平时 opacity-0、hover 才显。
/// 它们是**真 <button>、始终在 Tab 序里**——若只随 hover 显现，纯键盘用户（含运动障碍者）会 Tab 到一串**隐形**
/// 按钮、看不清焦点落在哪。修复：随 group-focus-within（焦点进气泡即整排显现，与 hover 对等）+ 兜底 focus-visible。
/// 本测锁住该 class 不被回退（CSS 实际生成已在构建产物中人工核验）。
describe('Chat 消息操作按钮键盘可见性（焦点进气泡即显现，不留"隐形却可 Tab 到"的按钮）', () => {
  it('hover 才显的操作按钮带 group-focus-within:opacity-100（键盘聚焦时也显现）', async () => {
    mock(api.conversations).mockResolvedValue({ conversations: [
      { peer: { id: 'm1', username: 'xiaoming', displayName: '小明', role: 'blind', status: 'active', avatar: null }, last: { id: 'l1', fromId: 'm1', toId: 'me', kind: 'text', text: '你好', createdAt: 1_700_000_000_000 }, unread: 0, muted: false, online: true },
    ] })
    mock(api.groups).mockResolvedValue({ groups: [] })
    mock(api.markRead).mockResolvedValue({})
    mock(api.lookupUser).mockResolvedValue({ user: null })
    mock(api.familyLinks).mockResolvedValue({ links: [] })
    mock(api.messagesWith).mockResolvedValue({ messages: [
      { id: 'msg1', fromId: 'm1', toId: 'me', kind: 'text', text: '帮我看看这段', createdAt: 1_700_000_000_000 },
    ] })

    const { findByText, getAllByLabelText } = render(<ChatPage />)
    await findByText('帮我看看这段')
    const reactButtons = getAllByLabelText('表情回应') // 每条消息一枚"回应"按钮（hover 才显那类）
    expect(reactButtons.length).toBeGreaterThan(0)
    for (const btn of reactButtons) {
      expect(btn.tagName).toBe('BUTTON')                              // 真按钮 → 恒在 Tab 序里
      expect(btn.className).toContain('opacity-0')                    // 默认隐藏（非永久占位）
      expect(btn.className).toContain('group-focus-within:opacity-100') // 键盘焦点进气泡 → 整排显现
    }
  })
})
