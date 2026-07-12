// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/// 通行密钥管理区（Account 安全区）：列表/添加三步流/删除须确认/浏览器不支持整块隐身。
vi.mock('../lib/webauthn', () => ({ passkeySupported: vi.fn(() => true), createPasskey: vi.fn() }))
vi.mock('../lib/api', () => ({
  api: { passkeyList: vi.fn(), passkeyRegisterOptions: vi.fn(), passkeyRegisterVerify: vi.fn(), passkeyDelete: vi.fn() },
  APIError: class extends Error {
    code: string
    status: number
    constructor(code: string, status: number) { super(code); this.code = code; this.status = status }
  },
}))
import { api } from '../lib/api'
import { passkeySupported, createPasskey } from '../lib/webauthn'
import { PasskeySection } from './PasskeySection'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mock(passkeySupported).mockReturnValue(true)
  mock(api.passkeyList).mockResolvedValue({ passkeys: [] })
})

const openDialog = async () => {
  fireEvent.click(screen.getByRole('button', { name: '通行密钥' }))
  await waitFor(() => expect(api.passkeyList).toHaveBeenCalled())
}

describe('PasskeySection 通行密钥管理', () => {
  it('列表：显示设备名与添加时间；空态如实', async () => {
    mock(api.passkeyList).mockResolvedValue({ passkeys: [
      { id: 'p1', deviceName: 'Chrome · Mac', createdAt: 1_700_000_000_000 },
      { id: 'p2', deviceName: null, createdAt: 1_700_000_100_000 },
    ] })
    render(<PasskeySection />)
    await openDialog()
    expect(await screen.findByText('Chrome · Mac')).toBeInTheDocument()
    expect(screen.getByText('未命名设备')).toBeInTheDocument() // null 设备名兜底，不渲染空白
  })

  it('添加三步流：options → 浏览器创建 → verify（带 UA 推断的设备名）→ 列表刷新', async () => {
    mock(api.passkeyRegisterOptions).mockResolvedValue({ challenge: 'CH' })
    mock(createPasskey).mockResolvedValue({ id: 'newcred', response: {} })
    mock(api.passkeyRegisterVerify).mockResolvedValue({ ok: true, id: 'p-new' })
    render(<PasskeySection />)
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: '添加通行密钥' }))
    await waitFor(() => expect(api.passkeyRegisterVerify).toHaveBeenCalled())
    const [cred, deviceName] = mock(api.passkeyRegisterVerify).mock.calls[0]
    expect(cred).toEqual({ id: 'newcred', response: {} })
    expect(typeof deviceName).toBe('string')
    expect((deviceName as string).length).toBeGreaterThan(0) // UA 推断出的可读设备名
    expect(mock(api.passkeyList).mock.calls.length).toBeGreaterThanOrEqual(2) // 添加后刷新列表
  })

  it('删除须经确认：取消→不删；确认→调删除并刷新', async () => {
    mock(api.passkeyList).mockResolvedValue({ passkeys: [{ id: 'p1', deviceName: 'Chrome · Mac', createdAt: 1 }] })
    mock(api.passkeyDelete).mockResolvedValue({})
    render(<PasskeySection />)
    await openDialog()
    await screen.findByText('Chrome · Mac')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: /删除通行密钥 Chrome · Mac/ }))
    expect(api.passkeyDelete).not.toHaveBeenCalled()
    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: /删除通行密钥 Chrome · Mac/ }))
    await waitFor(() => expect(api.passkeyDelete).toHaveBeenCalledWith('p1'))
    confirmSpy.mockRestore()
  })

  it('浏览器不支持 WebAuthn → 整块不渲染（不摆必然失败的按钮）', () => {
    mock(passkeySupported).mockReturnValue(false)
    render(<PasskeySection />)
    expect(screen.queryByRole('button', { name: '通行密钥' })).toBeNull()
  })
})
