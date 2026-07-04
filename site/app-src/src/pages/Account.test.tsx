// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'u1', username: 'amin', displayName: '阿明', role: 'helper' }, refreshMe: vi.fn(), signOut: vi.fn() }) }))
vi.mock('../lib/api', () => ({
  api: { me: vi.fn(), verificationStatus: vi.fn(), setProfile: vi.fn(), setRole: vi.fn(), setLanguage: vi.fn(), deleteAccount: vi.fn(), setEmail: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { AccountPage } from './Account'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('AccountPage 资料渲染（防字段漂移）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock(api.verificationStatus).mockResolvedValue({ status: 'none' })
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
})
