// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'u1', username: 'amin', displayName: '阿明', role: 'helper' }, refreshMe: vi.fn(), signOut: vi.fn() }) }))
vi.mock('../lib/api', () => ({
  api: { me: vi.fn(), verificationStatus: vi.fn(), setProfile: vi.fn(), setAvatar: vi.fn(), setRole: vi.fn(), setLanguage: vi.fn(), deleteAccount: vi.fn(), setEmail: vi.fn(), quietHours: vi.fn(), setQuietHours: vi.fn(), withdrawVerification: vi.fn(), submitVerification: vi.fn(), sessions: vi.fn(), setReadReceipts: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
  reencodeToJpeg: vi.fn(), blobToDataUrl: vi.fn(), uploadVerificationDoc: vi.fn(),
}))
import { api, reencodeToJpeg, blobToDataUrl, uploadVerificationDoc } from '../lib/api'
import { AccountPage, VerificationDialog, SessionsDialog } from './Account'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('AccountPage 资料渲染（防字段漂移）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock(api.verificationStatus).mockResolvedValue({ status: 'none' })
    mock(api.quietHours).mockResolvedValue({ quietHours: null }) // 勿扰卡默认无配置
  })

  it('锁定 username/email/emailVerified/twoFactorEnabled 渲染键', async () => {
    mock(api.me).mockResolvedValue({
      id: 'u1', username: 'amin', displayName: '阿明', role: 'helper',
      email: 'a@b.com', emailVerified: true, twoFactorEnabled: true, usernameCustomized: true, verified: false,
    })
    render(<AccountPage />)
    expect(await screen.findByText(/@amin/)).toBeInTheDocument()   // 用户名（@username · 身份）
    expect(screen.getByText(/a@b\.com/)).toBeInTheDocument()       // email
    expect(screen.getByText('已验证')).toBeInTheDocument()         // emailVerified=true → 邮箱"已验证"
    expect(screen.getByText('已开启')).toBeInTheDocument()         // twoFactorEnabled=true → "已开启"
  })

  it('已读回执开关：me.readReceiptsEnabled=false → 开关呈关；点击 → setReadReceipts(true)（互惠隐私）', async () => {
    mock(api.me).mockResolvedValue({ id: 'u1', username: 'amin', displayName: '阿明', role: 'helper', usernameCustomized: true, verified: false, readReceiptsEnabled: false })
    mock(api.setReadReceipts).mockResolvedValue({ ok: true, readReceiptsEnabled: true })
    render(<AccountPage />)
    await screen.findByText(/@amin/)
    const sw = await screen.findByRole('switch', { name: '已读回执' })
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false')) // self 到达后校正为服务器值
    fireEvent.click(sw)
    await waitFor(() => expect(api.setReadReceipts).toHaveBeenCalledWith(true)) // 关→开
  })

  it('注销账户须重新输入密码，并以密码调用 deleteAccount（防被盗会话一键毁号）', async () => {
    mock(api.me).mockResolvedValue({ id: 'u1', username: 'amin', displayName: '阿明', role: 'helper', usernameCustomized: true, verified: false })
    mock(api.deleteAccount).mockResolvedValue(undefined)
    render(<AccountPage />)
    await screen.findByText(/@amin/)
    // 打开注销弹窗。
    fireEvent.click(screen.getByRole('button', { name: '注销账户' }))
    // 空密码时「永久注销」禁用（防误触/空提交）。
    const confirmBtn = await screen.findByRole('button', { name: '永久注销' })
    expect(confirmBtn).toBeDisabled()
    // 输入当前密码 → 按钮可用 → 确认以密码调用 deleteAccount。
    const pwInput = document.querySelector('input[type="password"]') as HTMLInputElement
    fireEvent.change(pwInput, { target: { value: 'my-current-pw' } })
    expect(confirmBtn).not.toBeDisabled()
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(api.deleteAccount).toHaveBeenCalledWith('my-current-pw'))
  })

  it('更换头像：选图→重编码为 256px→data URL→setAvatar 上传（对齐 iOS，web 此前只显示不可改）', async () => {
    mock(api.me).mockResolvedValue({ id: 'u1', username: 'amin', displayName: '阿明', role: 'helper', usernameCustomized: true, verified: false })
    mock(reencodeToJpeg).mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }))
    mock(blobToDataUrl).mockResolvedValue('data:image/jpeg;base64,AAAA')
    mock(api.setAvatar).mockResolvedValue({ ok: true })
    render(<AccountPage />)
    await screen.findByText(/@amin/)
    const file = new File(['x'], 'me.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('avatar-input'), { target: { files: [file] } })
    await waitFor(() => expect(reencodeToJpeg).toHaveBeenCalledWith(file, 256)) // 头像压到 256px 长边，远在 600KB 内
    await waitFor(() => expect(api.setAvatar).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA')) // 上传 data URL
  })

  it('未绑邮箱/未开 2FA → 显示"未绑定"/"未开启"', async () => {
    mock(api.me).mockResolvedValue({
      id: 'u1', username: 'amin', displayName: '阿明', role: 'helper',
      email: null, emailVerified: false, twoFactorEnabled: false, usernameCustomized: true, verified: false,
    })
    render(<AccountPage />)
    expect(await screen.findByText('未绑定')).toBeInTheDocument()
    expect(screen.getByText('未开启')).toBeInTheDocument()
  })

  it('发送改邮箱验证码成功即触发父组件重拉 self（防"未输码就关弹窗仍显旧邮箱+已验证"的安全误导，复审 MED）', async () => {
    mock(api.me).mockResolvedValue({
      id: 'u1', username: 'amin', displayName: '阿明', role: 'helper',
      email: 'old@x.com', emailVerified: true, twoFactorEnabled: false, usernameCustomized: true, verified: false,
    })
    mock(api.setEmail).mockResolvedValue({ ok: true })
    render(<AccountPage />)
    await screen.findByText(/old@x\.com/)              // 挂载首拉，安全卡显旧邮箱
    const meCallsBefore = mock(api.me).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /邮箱|Email/ }))   // 开 EmailDialog
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@y.com' } })
    fireEvent.click(screen.getByRole('button', { name: /发送验证码|Send code/ }))
    await waitFor(() => expect(api.setEmail).toHaveBeenCalledWith('new@y.com'))
    // onChanged 已在 sendCode 成功后触发 → 再次拉 /api/me 使父 self 同步为新（未验证）邮箱，安全卡不再留旧值
    await waitFor(() => expect(mock(api.me).mock.calls.length).toBeGreaterThan(meCallsBefore))
  })

  it('勿扰时段：开关切换即保存并回显；已配置则回填时间', async () => {
    mock(api.me).mockResolvedValue({ id: 'u1', username: 'amin', displayName: '阿明', role: 'helper', usernameCustomized: true, verified: false })
    mock(api.quietHours).mockResolvedValue({ quietHours: null })
    mock(api.setQuietHours).mockResolvedValue({ quietHours: { enabled: true, startMinute: 1320, endMinute: 420, tz: 'Asia/Shanghai' } })
    render(<AccountPage />)
    const sw = await screen.findByRole('switch', { name: '勿扰时段' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw)
    // 切换即保存，且用服务端回值回显（enabled + 22:00–07:00 时间）
    await waitFor(() => expect(api.setQuietHours).toHaveBeenCalledWith(expect.objectContaining({ enabled: true })))
    await waitFor(() => expect(screen.getByRole('switch', { name: '勿扰时段' })).toHaveAttribute('aria-checked', 'true'))
    expect((screen.getByLabelText('勿扰开始时间') as HTMLInputElement).value).toBe('22:00') // 1320 分 → 22:00
    expect((screen.getByLabelText('勿扰结束时间') as HTMLInputElement).value).toBe('07:00') // 420 分 → 07:00
  })

  it('勿扰时段：已有配置进入即回填、开关为开', async () => {
    mock(api.me).mockResolvedValue({ id: 'u1', username: 'amin', displayName: '阿明', role: 'helper', usernameCustomized: true, verified: false })
    mock(api.quietHours).mockResolvedValue({ quietHours: { enabled: true, startMinute: 1350, endMinute: 390, tz: 'Asia/Shanghai' } })
    render(<AccountPage />)
    await waitFor(() => expect(screen.getByRole('switch', { name: '勿扰时段' })).toHaveAttribute('aria-checked', 'true'))
    expect((screen.getByLabelText('勿扰开始时间') as HTMLInputElement).value).toBe('22:30') // 1350
    expect((screen.getByLabelText('勿扰结束时间') as HTMLInputElement).value).toBe('06:30') // 390
  })
})

describe('VerificationDialog 撤回待审申请', () => {
  beforeEach(() => vi.clearAllMocks())

  it('待审状态显示"撤回申请"：点击 confirm 后调 withdrawVerification 并刷新', async () => {
    mock(api.withdrawVerification).mockResolvedValue({ ok: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onChanged = vi.fn()
    render(<VerificationDialog status={{ status: 'pending' }} onClose={vi.fn()} onChanged={onChanged} />)
    fireEvent.click(screen.getByTestId('withdraw-verif'))
    await waitFor(() => expect(api.withdrawVerification).toHaveBeenCalled())
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('取消 confirm 则不撤回；非待审状态（none）不显示撤回按钮', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { rerender } = render(<VerificationDialog status={{ status: 'pending' }} onClose={vi.fn()} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByTestId('withdraw-verif'))
    expect(api.withdrawVerification).not.toHaveBeenCalled() // 用户取消了 confirm
    rerender(<VerificationDialog status={{ status: 'none' }} onClose={vi.fn()} onChanged={vi.fn()} />)
    expect(screen.queryByTestId('withdraw-verif')).toBeNull() // none 状态无撤回入口
  })
})

describe('VerificationDialog 提交部分失败自动回滚', () => {
  beforeEach(() => vi.clearAllMocks())

  it('证件上传中途失败 → 自动 withdrawVerification 回滚，不留缺图 pending', async () => {
    mock(api.submitVerification).mockResolvedValue({ id: 'v1' })
    mock(reencodeToJpeg).mockImplementation(async (f: File) => f)
    mock(uploadVerificationDoc).mockImplementation(async (_id: string, kind: string) => { if (kind === 'selfie') throw new Error('network') })
    mock(api.withdrawVerification).mockResolvedValue({ ok: true })
    render(<VerificationDialog status={{ status: 'none' }} onClose={vi.fn()} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByText('开始认证'))
    fireEvent.click(screen.getByText('我同意并继续'))
    const boxes = screen.getAllByRole('textbox')
    fireEvent.change(boxes[0], { target: { value: '张三' } })
    fireEvent.change(boxes[1], { target: { value: '1234' } })
    const file = new File(['x'], 'id.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('证件正面照片'), { target: { files: [file] } })
    fireEvent.change(screen.getByLabelText('本人自拍'), { target: { files: [file] } })
    fireEvent.click(screen.getByText('提交审核'))
    await waitFor(() => expect(uploadVerificationDoc).toHaveBeenCalledWith('v1', 'selfie', expect.anything()))
    await waitFor(() => expect(api.withdrawVerification).toHaveBeenCalled())
  })

  it('全部成功 → 不回滚（withdrawVerification 不被调用）', async () => {
    mock(api.submitVerification).mockResolvedValue({ id: 'v2' })
    mock(reencodeToJpeg).mockImplementation(async (f: File) => f)
    mock(uploadVerificationDoc).mockResolvedValue(undefined)
    mock(api.withdrawVerification).mockResolvedValue({ ok: true })
    const onClose = vi.fn()
    render(<VerificationDialog status={{ status: 'none' }} onClose={onClose} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByText('开始认证'))
    fireEvent.click(screen.getByText('我同意并继续'))
    const boxes = screen.getAllByRole('textbox')
    fireEvent.change(boxes[0], { target: { value: '张三' } })
    fireEvent.change(boxes[1], { target: { value: '1234' } })
    const file = new File(['x'], 'id.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('证件正面照片'), { target: { files: [file] } })
    fireEvent.change(screen.getByLabelText('本人自拍'), { target: { files: [file] } })
    fireEvent.click(screen.getByText('提交审核'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(api.withdrawVerification).not.toHaveBeenCalled()
  })
})

describe('VerificationDialog 被拒显示管理员说明（死字段 rejectReasonNote）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('被拒时展示 reviewer note——服务端下发却从未呈现，用户此前不知具体哪里不对', () => {
    render(<VerificationDialog status={{ status: 'rejected', rejectReasonCode: 'other', rejectReasonNote: '身份证背面照缺失，请补拍清晰的背面' }} onClose={vi.fn()} onChanged={vi.fn()} />)
    expect(screen.getByText(/上次未通过/)).toBeInTheDocument()
    expect(screen.getByText(/审核说明/)).toBeInTheDocument()
    expect(screen.getByText(/身份证背面照缺失/)).toBeInTheDocument()
  })
  it('无 note 时不显示"审核说明"标签', () => {
    render(<VerificationDialog status={{ status: 'rejected', rejectReasonCode: 'other' }} onClose={vi.fn()} onChanged={vi.fn()} />)
    expect(screen.getByText(/上次未通过/)).toBeInTheDocument()
    expect(screen.queryByText(/审核说明/)).toBeNull()
  })
})

describe('SessionsDialog 首次登录时刻（死字段 createdAt，安全审查线索）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('会话有 createdAt → 显示"首次登录 <绝对时刻>"；无 createdAt 不显示', async () => {
    const created = new Date('2026-01-03T14:30:00').getTime()
    mock(api.sessions).mockResolvedValue({ sessions: [
      { sessionId: 's1', deviceLabel: 'iPhone 15', lastSeenAt: Date.now(), expiresAt: Date.now() + 1e9, current: true, createdAt: created },
      { sessionId: 's2', deviceLabel: 'Chrome', lastSeenAt: Date.now(), expiresAt: Date.now() + 1e9, current: false }, // 无 createdAt
    ] })
    render(<SessionsDialog onClose={() => {}} />)
    await screen.findByText('iPhone 15')
    // s1 有 createdAt → 出现"首次登录"+绝对日期(fmtTime medium)；恰一个（s2 无 createdAt 不出，故不误显 Invalid Date）。
    const rows = screen.getAllByText(/首次登录/)
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toMatch(/2026/) // 绝对年份可见（相对时间会随阅读漂移，安全时刻须绝对）
  })
})
