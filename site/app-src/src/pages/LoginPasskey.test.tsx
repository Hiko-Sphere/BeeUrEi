// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/// 登录页通行密钥流：按钮只在浏览器支持时出现；三步流成功即 signIn；
/// 错误面（密钥已被删/账号停用/用户取消）各有明确归宿——取消是改主意，不是错误，必须静默。
const signIn = vi.fn()
vi.mock('../lib/session', () => ({ useSession: () => ({ signIn }) }))
vi.mock('../lib/webauthn', () => ({ passkeySupported: vi.fn(() => true), getPasskey: vi.fn() }))
vi.mock('../lib/api', () => ({
  api: { login: vi.fn(), register: vi.fn(), passkeyLoginOptions: vi.fn(), passkeyLoginVerify: vi.fn() },
  APIError: class extends Error {
    code: string
    status: number
    constructor(code: string, status: number) { super(code); this.code = code; this.status = status }
  },
}))
import { api, APIError } from '../lib/api'
import { passkeySupported, getPasskey } from '../lib/webauthn'
import { LoginPage } from './Login'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mock(passkeySupported).mockReturnValue(true)
  mock(api.passkeyLoginOptions).mockResolvedValue({ flowId: 'f1', options: { challenge: 'CH', rpId: 'beeurei.hikosphere.com' } })
  mock(getPasskey).mockResolvedValue({ id: 'cred1', response: {} })
  mock(api.passkeyLoginVerify).mockResolvedValue({ token: 'tok', refreshToken: 'rtok', user: { id: 'me', displayName: '我' } })
})

describe('LoginPage 通行密钥登录', () => {
  it('三步流：options → 浏览器断言 → verify → signIn（免输账号密码）', async () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: /用通行密钥登录/ }))
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('tok', 'rtok', expect.objectContaining({ id: 'me' })))
    expect(api.passkeyLoginVerify).toHaveBeenCalledWith('f1', { id: 'cred1', response: {} })
  })

  it('浏览器不支持 → 按钮整个不出现（不摆必然失败的入口）', () => {
    mock(passkeySupported).mockReturnValue(false)
    render(<LoginPage />)
    expect(screen.queryByRole('button', { name: /用通行密钥登录/ })).toBeNull()
  })

  it('密钥已被删（unknown_credential）→ 说人话的错误；账号停用 → 明确告知', async () => {
    mock(api.passkeyLoginVerify).mockRejectedValue(new APIError('unknown_credential', 401))
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: /用通行密钥登录/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('这把通行密钥不属于任何账号')
    mock(api.passkeyLoginVerify).mockRejectedValue(new APIError('account_disabled', 403))
    fireEvent.click(screen.getByRole('button', { name: /用通行密钥登录/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('该账号已被停用'))
    expect(signIn).not.toHaveBeenCalled()
  })

  it('用户在系统弹窗里点了取消（NotAllowedError）→ 静默返回，不报错不 signIn', async () => {
    const cancel = new Error('cancelled'); cancel.name = 'NotAllowedError'
    mock(getPasskey).mockRejectedValue(cancel)
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: /用通行密钥登录/ }))
    await waitFor(() => expect(api.passkeyLoginOptions).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull() // 取消=改主意，不是错误
    expect(signIn).not.toHaveBeenCalled()
  })
})
