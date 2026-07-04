// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'u1', username: 'amin', displayName: '阿明', role: 'helper' }, refreshMe: vi.fn(), signOut: vi.fn() }) }))
vi.mock('../lib/api', () => ({
  api: { me: vi.fn(), verificationStatus: vi.fn(), setProfile: vi.fn(), setRole: vi.fn(), setLanguage: vi.fn(), deleteAccount: vi.fn(), setEmail: vi.fn(), quietHours: vi.fn(), setQuietHours: vi.fn(), withdrawVerification: vi.fn(), submitVerification: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
  reencodeToJpeg: vi.fn(), uploadVerificationDoc: vi.fn(),
}))
import { api, reencodeToJpeg, uploadVerificationDoc } from '../lib/api'
import { AccountPage, VerificationDialog } from './Account'

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
