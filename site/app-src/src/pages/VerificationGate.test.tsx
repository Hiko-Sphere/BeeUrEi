// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/// VerificationGate（实名认证门禁屏，曾 0% 覆盖）：管理员开启「要求实名认证」后未过审用户
/// 看到的**唯一**界面。状态呈现错了=用户不知道该干什么（尤其拒绝原因映射——不告诉人家
/// 为什么被拒、只让"重新提交"，就是打转）。
const refreshMe = vi.fn()
const signOut = vi.fn()
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', username: 'helper_wang' }, refreshMe, signOut }) }))
vi.mock('../lib/api', () => ({ api: { verificationStatus: vi.fn() } }))
// VerificationDialog 是独立重组件（拍照/上传），有自己的归属；此处只验门禁开合。
vi.mock('../components/VerificationDialog', () => ({ VerificationDialog: () => <div data-testid="verification-dialog" /> }))
import { api } from '../lib/api'
import { VerificationGate } from './VerificationGate'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mock(api.verificationStatus).mockResolvedValue({ status: 'none' })
})

describe('VerificationGate 实名门禁', () => {
  it('未提交（none）→ 说明 + 「开始实名认证」；点开弹认证对话框', async () => {
    render(<VerificationGate />)
    expect(await screen.findByText('需要先完成实名认证')).toBeInTheDocument()
    const start = screen.getByRole('button', { name: '开始实名认证' })
    fireEvent.click(start)
    expect(screen.getByTestId('verification-dialog')).toBeInTheDocument()
    expect(screen.getByText('@helper_wang')).toBeInTheDocument() // 当前账号可辨（防"我登错号了？"）
  })

  it('审核中（pending）→ 明示时限预期 + 按钮变「查看认证状态」', async () => {
    mock(api.verificationStatus).mockResolvedValue({ status: 'pending' })
    render(<VerificationGate />)
    expect(await screen.findByText(/审核中，通常 1–2 个工作日/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看认证状态' })).toBeInTheDocument()
  })

  it('被拒（rejected）→ 拒绝原因如实映射（blurry→重拍指引）+「重新提交」', async () => {
    mock(api.verificationStatus).mockResolvedValue({ status: 'rejected', rejectReasonCode: 'blurry' })
    render(<VerificationGate />)
    expect(await screen.findByText(/上次未通过：证件照片不够清晰，请重拍。/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新提交' })).toBeInTheDocument()
  })

  it('被拒但拒绝码未知/缺失 → 落到通用文案（绝不渲染成 undefined）', async () => {
    mock(api.verificationStatus).mockResolvedValue({ status: 'rejected', rejectReasonCode: 'brand_new_code' })
    render(<VerificationGate />)
    expect(await screen.findByText(/上次未通过：审核未通过，请重新提交。/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/undefined/)
  })

  it('「我已通过，刷新」→ 重查认证状态 + 刷新会话身份（门禁由父级据 me 解除）', async () => {
    render(<VerificationGate />)
    await screen.findByText('需要先完成实名认证')
    expect(api.verificationStatus).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '我已通过，刷新' }))
    await waitFor(() => expect(refreshMe).toHaveBeenCalledTimes(1))
    expect(api.verificationStatus).toHaveBeenCalledTimes(2)
  })

  it('退出登录须经确认：取消→不退出；确认→signOut（被门禁拦住的人至少能换账号）', async () => {
    render(<VerificationGate />)
    await screen.findByText('需要先完成实名认证')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect(signOut).not.toHaveBeenCalled()
    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect(signOut).toHaveBeenCalledTimes(1)
    confirmSpy.mockRestore()
  })
})
