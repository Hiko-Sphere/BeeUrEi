// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// useToast/useI18n 有默认 ctx；mock api + useCall(避 webrtc 链) + react-router 的 useNavigate。
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('./call/CallController', () => ({ useCall: () => ({ startOutgoing: vi.fn(), active: null }) }))
vi.mock('../lib/api', () => ({
  api: { familyLinks: vi.fn(), incomingLinks: vi.fn(), blocks: vi.fn(), unblock: vi.fn(), block: vi.fn(), deleteLink: vi.fn(), acceptLink: vi.fn(), addLink: vi.fn(), lookupUser: vi.fn(), setLinkEmergency: vi.fn(), safetyCheckin: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { FamilyPage } from './Family'
import { axeViolations } from '../lib/axeCheck'

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

  it('联系人有电话时显示可拨打的 tel: 链接（死字段修复：服务端一直下发 phone，之前 web 从不呈现）', async () => {
    mock(api.blocks).mockResolvedValue({ blocks: [] })
    mock(api.familyLinks).mockResolvedValue({ links: [
      { id: 'l1', memberId: 'u1', memberName: '妈妈', relation: '家人', isEmergency: false, status: 'accepted', phone: '+86 138-0013-8000' },
      { id: 'l2', memberId: 'u2', memberName: '老王', relation: '邻居', isEmergency: false, status: 'accepted' }, // 无 phone：不出拨号链接
    ] })
    render(<FamilyPage />)
    const link = await screen.findByLabelText('拨打电话 +86 138-0013-8000')
    expect(link).toHaveAttribute('href', 'tel:+8613800138000') // 清洗空格/连字符、保留 +/数字
    expect(link).toHaveTextContent('+86 138-0013-8000')        // 展示原始格式供核对
    expect(screen.getByText('老王')).toBeInTheDocument()        // 无 phone 者正常渲染、无拨号链接
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('tel:'))).toHaveLength(1)
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

  it('加联系人：手机号查到用户 → 按 userId 提交（常规路径不回退）', async () => {
    mock(api.blocks).mockResolvedValue({ blocks: [] })
    mock(api.lookupUser).mockResolvedValue({ user: { id: 'u7', displayName: '老李' } })
    mock(api.addLink).mockResolvedValue({ link: {} })
    render(<FamilyPage />)
    fireEvent.click(await screen.findByText('添加'))
    fireEvent.change(await screen.findByPlaceholderText(/alice/), { target: { value: '13800138000' } })
    fireEvent.click(screen.getByText('发送请求'))
    await waitFor(() => expect(api.lookupUser).toHaveBeenCalledWith('13800138000'))
    await waitFor(() => expect(api.addLink).toHaveBeenCalledWith({ userId: 'u7' }, expect.anything(), false))
  })

  it('加联系人：纯数字（幸运号）用户名 8888——lookupUser 服务端先按用户名解析即查到，按 userId 提交（无需客户端回退）', async () => {
    mock(api.blocks).mockResolvedValue({ blocks: [] })
    // 服务端 findByLoginIdentifier 先 findByUsername，故纯数字用户名经 lookupUser 也能查到该用户。
    mock(api.lookupUser).mockResolvedValue({ user: { id: 'u8', displayName: '八爷' } })
    mock(api.addLink).mockResolvedValue({ link: {} })
    render(<FamilyPage />)
    fireEvent.click(await screen.findByText('添加'))
    fireEvent.change(await screen.findByPlaceholderText(/alice/), { target: { value: '88888' } })
    fireEvent.click(screen.getByText('发送请求'))
    await waitFor(() => expect(api.lookupUser).toHaveBeenCalledWith('88888'))
    await waitFor(() => expect(api.addLink).toHaveBeenCalledWith({ userId: 'u8' }, expect.anything(), false))
  })

  it('加联系人：查无（用户名/手机号/邮箱都无此人）→ 报"未找到"，不调 addLink', async () => {
    mock(api.blocks).mockResolvedValue({ blocks: [] })
    mock(api.lookupUser).mockResolvedValue({ user: null })
    mock(api.addLink).mockResolvedValue({ link: {} })
    render(<FamilyPage />)
    fireEvent.click(await screen.findByText('添加'))
    fireEvent.change(await screen.findByPlaceholderText(/alice/), { target: { value: '99999' } })
    fireEvent.click(screen.getByText('发送请求'))
    await waitFor(() => expect(api.lookupUser).toHaveBeenCalledWith('99999'))
    expect(api.addLink).not.toHaveBeenCalled() // lookup 空即"未找到"，不再多打一次 addLink
  })

  it('加联系人：邮箱查无 → **不**回退用户名（邮箱格式不可能是用户名），不调 addLink', async () => {
    mock(api.blocks).mockResolvedValue({ blocks: [] })
    mock(api.lookupUser).mockResolvedValue({ user: null })
    mock(api.addLink).mockResolvedValue({ link: {} })
    render(<FamilyPage />)
    fireEvent.click(await screen.findByText('添加'))
    fireEvent.change(await screen.findByPlaceholderText(/alice/), { target: { value: 'nobody@example.com' } })
    fireEvent.click(screen.getByText('发送请求'))
    await waitFor(() => expect(api.lookupUser).toHaveBeenCalledWith('nobody@example.com'))
    expect(api.addLink).not.toHaveBeenCalled() // 邮箱查无=确实没有，不回退
  })
})

// 无障碍回归门禁（axe）：亲友页近期新增了安全报到卡、在线圆点、紧急联系人方向徽标——
// 这些正是服务视障用户的关键界面，控件无名/aria 误用/列表结构破损都会直接伤害读屏用户，须 0 违规。
describe('FamilyPage 无障碍（axe 0 违规：安全报到卡 + 在线 + 紧急方向徽标）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock(api.blocks).mockResolvedValue({ blocks: [] })
    mock(api.safetyCheckin).mockResolvedValue({ timer: null, hasEmergencyContact: true }) // 空闲态：渲染时长选择/备注/开始按钮
  })

  it('空闲安全报到卡 + 在线/离线 + 我的紧急联系人/我是对方的紧急联系人 两向徽标', async () => {
    mock(api.familyLinks).mockResolvedValue({ links: [
      { id: 'l1', memberId: 'u1', memberName: '妈妈', relation: '家人', isEmergency: true, amOwner: true, status: 'accepted', online: true },   // theyAreMine
      { id: 'l2', memberId: 'u2', memberName: '小明', relation: '邻居', isEmergency: true, amOwner: false, status: 'accepted', online: false },  // iAmTheirs
    ] })
    mock(api.incomingLinks).mockResolvedValue({ links: [
      { id: 'i1', ownerId: 'u3', ownerName: '陌生人', relation: '志愿者', isEmergency: true, status: 'pending' },
    ] })
    const { container } = render(<FamilyPage />)
    await screen.findByText('妈妈')                 // 等列表渲染完成
    await screen.findByText('开始报到')             // 等安全报到卡（空闲态）渲染
    expect(await axeViolations(container)).toEqual([])
  })

  it('进行中安全报到卡（剩余时间 + 我平安了/延长/取消）无违规', async () => {
    mock(api.familyLinks).mockResolvedValue({ links: [] })
    mock(api.incomingLinks).mockResolvedValue({ links: [] })
    mock(api.safetyCheckin).mockResolvedValue({ timer: { id: 't1', status: 'active', startedAt: 1, dueAt: 9e12, remainingSec: 1800, note: '去菜场' }, hasEmergencyContact: true })
    const { container } = render(<FamilyPage />)
    await screen.findByText('我平安了')
    expect(await axeViolations(container)).toEqual([])
  })
})

// 进行中安全报到的"无紧急联系人"持续预警（防假安心；重载后仍在，非只 start 一刻的 toast）。
describe('SafetyCheckInCard 进行中无紧急联系人 → 持续警告横幅', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock(api.blocks).mockResolvedValue({ blocks: [] })
    mock(api.familyLinks).mockResolvedValue({ links: [] })
    mock(api.incomingLinks).mockResolvedValue({ links: [] })
  })

  it('active + hasEmergencyContact=false → 显示 role=alert 警告横幅', async () => {
    mock(api.safetyCheckin).mockResolvedValue({ timer: { id: 't1', status: 'active', startedAt: 1, dueAt: 9e12, remainingSec: 1800 }, hasEmergencyContact: false })
    render(<FamilyPage />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/你还没有紧急联系人/)
    expect(alert).toHaveTextContent(/无人会被通知/)
  })

  it('active + hasEmergencyContact=true → 无警告横幅', async () => {
    mock(api.safetyCheckin).mockResolvedValue({ timer: { id: 't2', status: 'active', startedAt: 1, dueAt: 9e12, remainingSec: 1800 }, hasEmergencyContact: true })
    render(<FamilyPage />)
    await screen.findByText('我平安了') // 等进行中卡渲染
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('FamilyPage 紧急联系人责任提醒（我是几人的紧急联系人）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock(api.blocks).mockResolvedValue({ blocks: [] })
    mock(api.incomingLinks).mockResolvedValue({ links: [] })
    mock(api.safetyCheckin).mockResolvedValue({ timer: null, hasEmergencyContact: true })
  })

  it('有 amOwner=false∧isEmergency 的已接受联系人 → 显示"你是 N 位联系人的紧急联系人"（只数我是对方的）', async () => {
    mock(api.familyLinks).mockResolvedValue({ links: [
      { id: 'l1', memberId: 'u1', memberName: 'A', relation: '家人', isEmergency: true, amOwner: false, status: 'accepted' }, // 我是 A 的紧急联系人
      { id: 'l2', memberId: 'u2', memberName: 'B', relation: '家人', isEmergency: true, amOwner: false, status: 'accepted' }, // 我是 B 的紧急联系人
      { id: 'l3', memberId: 'u3', memberName: 'C', relation: '家人', isEmergency: true, amOwner: true, status: 'accepted' },  // C 是我的紧急联系人（不计）
      { id: 'l4', memberId: 'u4', memberName: 'D', relation: '家人', isEmergency: true, amOwner: false, status: 'pending' },  // 未接受（不计）
    ] })
    render(<FamilyPage />)
    expect(await screen.findByText(/你是 2 位联系人的紧急联系人/)).toBeInTheDocument()
  })

  it('无"我是对方紧急联系人"的关系 → 不显示提醒', async () => {
    mock(api.familyLinks).mockResolvedValue({ links: [
      { id: 'l1', memberId: 'u1', memberName: '阿明', relation: '邻居', isEmergency: true, amOwner: true, status: 'accepted' }, // 只是阿明是我的紧急联系人
    ] })
    render(<FamilyPage />)
    await screen.findByText('阿明') // 联系人已渲染（名字唯一，不与头像首字母冲突）
    expect(screen.queryByText(/位联系人的紧急联系人/)).toBeNull()
  })
})
