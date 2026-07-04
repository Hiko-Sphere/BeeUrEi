// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// useToast/useI18n 有默认 ctx；mock api + useCall(避 webrtc 链) + react-router 的 useNavigate。
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('./call/CallController', () => ({ useCall: () => ({ startOutgoing: vi.fn(), active: null }) }))
vi.mock('../lib/api', () => ({
  api: { familyLinks: vi.fn(), incomingLinks: vi.fn(), blocks: vi.fn(), unblock: vi.fn(), block: vi.fn(), deleteLink: vi.fn(), acceptLink: vi.fn(), addLink: vi.fn(), lookupUser: vi.fn(), setLinkEmergency: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { FamilyPage } from './Family'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('FamilyPage 黑名单渲染（回归：b.user.displayName，非已废弃的 b.blockedName）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock(api.familyLinks).mockResolvedValue({ links: [] })
    mock(api.incomingLinks).mockResolvedValue({ links: [] })
  })

  it('已拉黑用户显示其 displayName（修复前读错字段会显示空/"?"）', async () => {
    mock(api.blocks).mockResolvedValue({ blocks: [{ id: 'b1', user: { id: 'u9', displayName: '张三', avatar: null } }] })
    render(<FamilyPage />)
    // 后端返回 { id, user: publicUser }；渲染须取 b.user.displayName。
    expect(await screen.findByText('张三')).toBeInTheDocument()
  })

  it('已建立且在线的联系人显示"在线"标识；离线的不显示', async () => {
    mock(api.blocks).mockResolvedValue({ blocks: [] })
    mock(api.familyLinks).mockResolvedValue({ links: [
      { id: 'l1', memberId: 'u1', memberName: '妈妈', relation: '家人', isEmergency: false, status: 'accepted', online: true },
      { id: 'l2', memberId: 'u2', memberName: '老王', relation: '邻居', isEmergency: false, status: 'accepted', online: false },
    ] })
    render(<FamilyPage />)
    expect(await screen.findByText('妈妈')).toBeInTheDocument()
    expect(screen.getByText('老王')).toBeInTheDocument()
    // 恰一个"在线"标识（妈妈在线、老王离线）。
    expect(screen.getAllByText(/在线/)).toHaveLength(1)
  })

  it('我作为 owner 的联系人显示紧急联系人开关；点击调用 setLinkEmergency 切换', async () => {
    mock(api.blocks).mockResolvedValue({ blocks: [] })
    mock(api.setLinkEmergency).mockResolvedValue({ link: {} })
    mock(api.familyLinks).mockResolvedValue({ links: [
      { id: 'l1', memberId: 'u1', memberName: '妈妈', relation: '家人', isEmergency: false, amOwner: true, status: 'accepted' },
      { id: 'l2', memberId: 'u2', memberName: '老王', relation: '邻居', isEmergency: false, amOwner: false, status: 'accepted' }, // 非 owner：无开关
    ] })
    render(<FamilyPage />)
    // 我 owner 的妈妈有"设为紧急联系人"开关；老王（非 owner）没有。
    const setBtn = await screen.findByLabelText('设为紧急联系人')
    expect(setBtn).toBeInTheDocument()
    expect(screen.getAllByLabelText('设为紧急联系人')).toHaveLength(1) // 仅妈妈一个
    fireEvent.click(setBtn)
    await waitFor(() => expect(api.setLinkEmergency).toHaveBeenCalledWith('l1', true)) // 切到紧急
  })

  it('已是紧急联系人的开关点击 → 取消（setLinkEmergency(id,false)）', async () => {
    mock(api.blocks).mockResolvedValue({ blocks: [] })
    mock(api.setLinkEmergency).mockResolvedValue({ link: {} })
    mock(api.familyLinks).mockResolvedValue({ links: [
      { id: 'l1', memberId: 'u1', memberName: '妈妈', relation: '家人', isEmergency: true, amOwner: true, status: 'accepted' },
    ] })
    render(<FamilyPage />)
    const btn = await screen.findByLabelText('取消紧急联系人')
    fireEvent.click(btn)
    await waitFor(() => expect(api.setLinkEmergency).toHaveBeenCalledWith('l1', false))
  })
})
