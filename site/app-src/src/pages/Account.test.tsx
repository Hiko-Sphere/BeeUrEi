// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'u1', username: 'amin', displayName: '阿明', role: 'helper' }, refreshMe: vi.fn(), signOut: vi.fn() }) }))
vi.mock('../lib/api', () => ({
  api: { me: vi.fn(), verificationStatus: vi.fn(), setProfile: vi.fn(), setRole: vi.fn(), setLanguage: vi.fn(), deleteAccount: vi.fn() },
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
})
