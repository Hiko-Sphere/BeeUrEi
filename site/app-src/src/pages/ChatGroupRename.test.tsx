// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-router-dom', () => ({ useParams: () => ({}), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  SEARCH_LIMIT: 50, GLOBAL_SEARCH_LIMIT: 20, // Chat 搜索截断标注用常量（与真实 api.ts 同值）
  api: { conversations: vi.fn(), groups: vi.fn(), groupMessages: vi.fn(), markGroupRead: vi.fn(), searchMessages: vi.fn(), familyLinks: vi.fn(), renameGroup: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const groupRes = (ownerId: string) => ({
  groups: [{ group: { id: 'g1', name: '家庭群', ownerId, createdAt: 1000 }, members: [{ id: 'me', displayName: '我' }, { id: 'mem1', displayName: '小红' }], last: null, unread: 0 }],
})

async function openGroupInfo(ownerId: string) {
  mock(api.groups).mockResolvedValue(groupRes(ownerId))
  mock(api.groupMessages).mockResolvedValue({ messages: [] })
  render(<ChatPage />)
  fireEvent.click(await screen.findByText('家庭群'))               // 打开群 Thread
  fireEvent.click(await screen.findByRole('button', { name: '群信息' })) // 打开群信息弹窗
}

describe('ChatPage 群改名（群主可改；非群主无入口）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    mock(api.conversations).mockResolvedValue({ conversations: [] })
    mock(api.markGroupRead).mockResolvedValue({})
    mock(api.familyLinks).mockResolvedValue({ links: [] })
    mock(api.renameGroup).mockResolvedValue({ group: { id: 'g1', name: '看病陪同群', ownerId: 'me', createdAt: 1000 } })
  })

  it('已注销成员（username 空）→ 成员列表本地化「已注销用户」，不显示服务端硬编码名（i18n 收口）', async () => {
    // 服务端占位：deleted 成员 username='' + 硬编码中文 displayName。客户端据 username==='' 覆盖本地化。
    mock(api.groups).mockResolvedValue({
      groups: [{ group: { id: 'g1', name: '家庭群', ownerId: 'me', createdAt: 1000 },
        members: [{ id: 'me', displayName: '我', username: 'me' }, { id: 'gone', displayName: 'SERVER_HARDCODED', username: '' }],
        last: null, unread: 0 }],
    })
    mock(api.groupMessages).mockResolvedValue({ messages: [] })
    render(<ChatPage />)
    fireEvent.click(await screen.findByText('家庭群'))
    fireEvent.click(await screen.findByRole('button', { name: '群信息' }))
    expect(await screen.findByText('已注销用户')).toBeInTheDocument()   // 本地化占位（zh 默认）
    expect(screen.queryByText('SERVER_HARDCODED')).toBeNull()          // 绝不显示服务端原始串
  })

  it('群主：改名输入框可编辑 → 点「改名」调 renameGroup(g1, 新名)', async () => {
    await openGroupInfo('me') // 我是群主
    const input = await screen.findByLabelText('群名')
    expect((input as HTMLInputElement).value).toBe('家庭群')
    fireEvent.change(input, { target: { value: '看病陪同群' } })
    fireEvent.click(screen.getByRole('button', { name: '改名' }))
    await waitFor(() => expect(api.renameGroup).toHaveBeenCalledWith('g1', '看病陪同群'))
  })

  it('群主：名字未变或空 → 「改名」按钮禁用（不发无效请求）', async () => {
    await openGroupInfo('me')
    const btn = await screen.findByRole('button', { name: '改名' })
    expect(btn).toBeDisabled()                              // 初始等于原名 → 禁用
    fireEvent.change(screen.getByLabelText('群名'), { target: { value: '   ' } })
    expect(btn).toBeDisabled()                              // 空白 → 禁用
    expect(api.renameGroup).not.toHaveBeenCalled()
  })

  it('非群主：无改名输入框（只有群主能改）', async () => {
    await openGroupInfo('mem1') // 群主是别人
    await screen.findByText(/成员/)                          // 弹窗已开
    expect(screen.queryByLabelText('群名')).toBeNull()
    expect(screen.queryByRole('button', { name: '改名' })).toBeNull()
  })
})
