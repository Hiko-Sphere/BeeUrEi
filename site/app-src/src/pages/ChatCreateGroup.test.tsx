// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 无 peerId → 展示会话列表（"建群"入口在列表头）。
vi.mock('react-router-dom', () => ({ useParams: () => ({}), useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '我' } }) }))
vi.mock('../lib/api', () => ({
  SEARCH_LIMIT: 50, GLOBAL_SEARCH_LIMIT: 20, // Chat 搜索截断标注用常量（与真实 api.ts 同值）
  api: { conversations: vi.fn(), groups: vi.fn(), searchAllMessages: vi.fn(), familyLinks: vi.fn(), createGroup: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
  chatErrorText: () => 'err',
}))
import { api } from '../lib/api'
import { ChatPage } from './Chat'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('CreateGroupDialog 建群成员上限预检（与服务端 memberIds.max(49) 一致）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    mock(api.conversations).mockResolvedValue({ conversations: [] })
    mock(api.groups).mockResolvedValue({ groups: [] })
    mock(api.searchAllMessages).mockResolvedValue({ messages: [] })
    // 51 位已接受联系人：超出可邀上限（49），预检必须拦在客户端。
    mock(api.familyLinks).mockResolvedValue({ links: Array.from({ length: 51 }, (_, i) => (
      { id: `l${i}`, memberId: `m${i}`, memberName: `联系人${String(i).padStart(2, '0')}`, relation: '', isEmergency: false, status: 'accepted' }
    )) })
    mock(api.createGroup).mockResolvedValue({ group: {} })
  })

  it('勾满 49 人后：出现上限提示（role=status）、其余复选框 disabled、继续点不再增选；提交恰发 49 人', async () => {
    render(<ChatPage />)
    fireEvent.click(await screen.findByText('建群'))
    await screen.findByText('联系人00')
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(51)
    for (const b of boxes) fireEvent.click(b)                      // 全点一遍：仅前 49 个生效
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(49)
    expect(screen.getByRole('status')).toHaveTextContent('最多可选 49 人')  // 讲清为什么勾不上
    // 未选中的两个已 disabled（读屏播报"已停用"，非静默 no-op）。
    const unchecked = boxes.filter((b) => !(b as HTMLInputElement).checked)
    expect(unchecked).toHaveLength(2)
    expect(unchecked.every((b) => (b as HTMLInputElement).disabled)).toBe(true)
    // 已选的仍可取消（disabled 只作用于"再增选"）→ 取消一个后提示消失、其余恢复可选。
    const firstChecked = boxes.find((b) => (b as HTMLInputElement).checked)!
    fireEvent.click(firstChecked)
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(48)
    expect(screen.queryByRole('status')).toBeNull()
    expect(unchecked.every((b) => !(b as HTMLInputElement).disabled)).toBe(true)
    // 群名与提交：恰发 48 人（当前所选），绝不超服务端上限。
    fireEvent.change(screen.getByPlaceholderText('群名称'), { target: { value: '大家庭' } })
    fireEvent.click(screen.getByText('创建'))
    await waitFor(() => expect(api.createGroup).toHaveBeenCalled())
    expect(mock(api.createGroup).mock.calls[0][1]).toHaveLength(48)
  })

  it('群名输入上限 50（与服务端 name.max(50)、改名输入一致——此前 40 无端更紧）', async () => {
    render(<ChatPage />)
    fireEvent.click(await screen.findByText('建群'))
    expect(((await screen.findByPlaceholderText('群名称')) as HTMLInputElement).maxLength).toBe(50)
  })
})
