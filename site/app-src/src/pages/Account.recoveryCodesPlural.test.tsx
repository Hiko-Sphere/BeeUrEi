// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// 强制英文渲染：恢复码剩余数的单复数病语只出现在英文串（中文无复数）。剩 1 个码时须显示
// "1 recovery code left"（单数），此前硬编码复数会显示语病 "1 recovery codes left"——2FA 安全 UI，语法须正确。
// 恢复码逐次登录消耗、会真实走到剩 1，故 n==1 可达、是真 bug 非死枝。
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ lang: 'en', t: (_zh: string, en: string) => en, setLang: () => {} }) }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'u1', username: 'amin', displayName: '阿明', role: 'helper' }, refreshMe: vi.fn(), signOut: vi.fn() }) }))
vi.mock('../lib/api', () => ({
  api: { me: vi.fn(), verificationStatus: vi.fn(), setProfile: vi.fn(), setAvatar: vi.fn(), setRole: vi.fn(), setLanguage: vi.fn(), deleteAccount: vi.fn(), setEmail: vi.fn(), quietHours: vi.fn(), setQuietHours: vi.fn(), withdrawVerification: vi.fn(), submitVerification: vi.fn(), sessions: vi.fn(), setReadReceipts: vi.fn(), twoFAStatus: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
  reencodeToJpeg: vi.fn(), blobToDataUrl: vi.fn(), uploadVerificationDoc: vi.fn(),
}))
import { api } from '../lib/api'
import { AccountPage } from './Account'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('两步验证恢复码剩余数：英文单复数正确', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock(api.me).mockResolvedValue({ id: 'u1', username: 'amin', displayName: '阿明', role: 'helper', email: null, emailVerified: false, twoFactorEnabled: true, usernameCustomized: true, verified: false })
    mock(api.verificationStatus).mockResolvedValue({ status: 'none' })
    mock(api.quietHours).mockResolvedValue({ quietHours: null })
  })

  it('剩 1 个恢复码 → "1 recovery code left"（单数，非 codes）', async () => {
    mock(api.twoFAStatus).mockResolvedValue({ enabled: true, recoveryCodesRemaining: 1 })
    render(<AccountPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Two-factor/ }))
    expect(await screen.findByText('1 recovery code left')).toBeInTheDocument()
  })

  it('剩 2 个恢复码 → "2 recovery codes left"（复数）', async () => {
    mock(api.twoFAStatus).mockResolvedValue({ enabled: true, recoveryCodesRemaining: 2 })
    render(<AccountPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Two-factor/ }))
    expect(await screen.findByText('2 recovery codes left')).toBeInTheDocument()
  })
})
