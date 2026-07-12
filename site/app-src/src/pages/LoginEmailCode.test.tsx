// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/// 登录页邮箱验证码流（免密，与 iOS 同链）：发码→验码→signIn；2FA 账号第三步补验证码；
/// 错误面各有说人话的归宿（冷却/邮件服务不可用/注册关闭）。
const signIn = vi.fn()
vi.mock('../lib/session', () => ({ useSession: () => ({ signIn }) }))
vi.mock('../lib/webauthn', () => ({ passkeySupported: vi.fn(() => false), getPasskey: vi.fn() }))
vi.mock('../lib/api', () => ({
  api: { login: vi.fn(), register: vi.fn(), emailRequestCode: vi.fn(), emailVerifyCode: vi.fn() },
  APIError: class extends Error {
    code: string
    status: number
    constructor(code: string, status: number) { super(code); this.code = code; this.status = status }
  },
}))
import { api, APIError } from '../lib/api'
import { LoginPage } from './Login'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mock(api.emailRequestCode).mockResolvedValue({ ok: true })
  mock(api.emailVerifyCode).mockResolvedValue({ token: 'tok', refreshToken: 'rtok', user: { id: 'me', displayName: '我' } })
})

async function enterEmailPanelAndSend(email = 'mom@example.com') {
  fireEvent.click(screen.getByRole('button', { name: /邮箱验证码登录/ }))
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
  await waitFor(() => expect(api.emailRequestCode).toHaveBeenCalledWith(email))
}

describe('LoginPage 邮箱验证码登录', () => {
  it('发码→验码→signIn（免密码全流程）；面板明示未注册邮箱会自动建号', async () => {
    render(<LoginPage />)
    await enterEmailPanelAndSend()
    expect(screen.getByRole('status')).toHaveTextContent('验证码已发送')
    expect(screen.getByText(/未注册的邮箱会自动创建新账号/)).toBeInTheDocument() // 诚实告知副作用
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '482913' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并登录' }))
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('tok', 'rtok', expect.objectContaining({ id: 'me' })))
    expect(api.emailVerifyCode).toHaveBeenCalledWith('mom@example.com', '482913', undefined)
  })

  it('开了 2FA 的账号：verify 返回 two_factor_required → 追加两步验证码输入，重交带 totpCode', async () => {
    mock(api.emailVerifyCode).mockRejectedValueOnce(new APIError('two_factor_required', 401))
    render(<LoginPage />)
    await enterEmailPanelAndSend()
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '482913' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并登录' }))
    const totp = await screen.findByLabelText(/两步验证码/)
    expect(screen.queryByRole('alert')).toBeNull() // 需要第二因子不是错误
    fireEvent.change(totp, { target: { value: '000111' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并登录' }))
    await waitFor(() => expect(signIn).toHaveBeenCalled())
    expect(mock(api.emailVerifyCode).mock.calls.at(-1)).toEqual(['mom@example.com', '482913', { totpCode: '000111' }])
  })

  it('错误面说人话：发送冷却→稍等再试；邮件服务故障→改用密码；注册关闭→明示未注册且不开放', async () => {
    mock(api.emailRequestCode).mockRejectedValueOnce(new APIError('code_cooldown', 429))
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: /邮箱验证码登录/ }))
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'mom@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('发送太频繁')
    mock(api.emailRequestCode).mockRejectedValueOnce(new APIError('mail_unavailable', 503))
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('邮件服务暂时不可用'))
    mock(api.emailRequestCode).mockResolvedValue({ ok: true })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    await screen.findByLabelText('验证码')
    mock(api.emailVerifyCode).mockRejectedValue(new APIError('registration_disabled', 403))
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '111222' } })
    fireEvent.click(screen.getByRole('button', { name: '验证并登录' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('未开放新账号注册'))
    expect(signIn).not.toHaveBeenCalled()
  })

  it('重新发送验证码：再次发码并清已填的旧码；返回密码登录清面板状态', async () => {
    render(<LoginPage />)
    await enterEmailPanelAndSend()
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: '重新发送验证码' }))
    await waitFor(() => expect(api.emailRequestCode).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: '返回密码登录' }))
    expect(screen.getByPlaceholderText('请输入密码')).toBeInTheDocument() // 回到密码表单
    expect(screen.queryByLabelText('验证码')).toBeNull()
  })
})
