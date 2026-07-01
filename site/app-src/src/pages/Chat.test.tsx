// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'

// ChatPage 列表视图只用 useParams/useNavigate(router) + useI18n(默认 ctx) + api；
// useSession/useToast 仅在 Thread 内（无 peerId、未选会话时不渲染）。无 peerId → 不触发预选。
vi.mock('react-router-dom', () => ({ useParams: () => ({}), useNavigate: () => vi.fn() }))
vi.mock('../lib/api', () => ({
  api: { conversations: vi.fn(), groups: vi.fn(), lookupUser: vi.fn(), familyLinks: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const msg = (over: Record<string, unknown>) => ({ id: 'm', fromId: 'x', toId: 'y', kind: 'text', text: '', createdAt: 0, ...over })

describe('ChatPage 会话列表渲染（防字段漂移 + 合并排序）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('单聊/群聊按最近消息时间降序合并；锁定 displayName/未读/成员数/预览字段', async () => {
    mock(api.conversations).mockResolvedValue({
      conversations: [
        { peer: { id: 'p1', displayName: '阿姨', avatar: null }, last: msg({ id: 'm3', text: '晚饭吃了吗', createdAt: 3000 }), unread: 2 },
        { peer: { id: 'p2', displayName: '老王', avatar: null }, last: msg({ id: 'm1', kind: 'image', createdAt: 1000 }), unread: 0 },
      ],
    })
    mock(api.groups).mockResolvedValue({
      // last=null → ts 回退到 group.createdAt(2000)，应排在 3000 与 1000 之间。
      groups: [{ group: { id: 'g1', name: '家庭群', ownerId: 'o1', createdAt: 2000 }, members: [{ id: 'a' }, { id: 'b' }], last: null, unread: 5 }],
    })
    render(<ChatPage />)

    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(3)
    // 排序：阿姨(3000) > 家庭群(2000 回退) > 老王(1000)。
    expect(rows[0]).toHaveTextContent('阿姨')
    expect(rows[1]).toHaveTextContent('家庭群')
    expect(rows[2]).toHaveTextContent('老王')

    // 字段 + 预览（按 kind）。
    expect(rows[0]).toHaveTextContent('晚饭吃了吗')           // 文本预览
    expect(within(rows[0]).getByText('2')).toBeInTheDocument() // 未读角标
    expect(rows[1]).toHaveTextContent('暂无消息')             // last=null
    expect(within(rows[1]).getByText('2')).toBeInTheDocument() // 成员数 Pill
    expect(within(rows[1]).getByText('5')).toBeInTheDocument() // 未读
    expect(rows[2]).toHaveTextContent('[图片]')               // image kind 预览

    // 键盘无障碍（防回归）：每行内容包在 <button> 中，可 Tab 聚焦 + Enter/Space 激活；
    // 此前 onClick 直接挂在 <li> 上，键盘/读屏用户完全无法选择会话。
    for (const row of rows) expect(within(row).getByRole('button')).toBeInTheDocument()
  })

  it('无任何会话 → 空状态，不渲染列表项', async () => {
    mock(api.conversations).mockResolvedValue({ conversations: [] })
    mock(api.groups).mockResolvedValue({ groups: [] })
    render(<ChatPage />)
    expect(await screen.findByText('暂无会话')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
