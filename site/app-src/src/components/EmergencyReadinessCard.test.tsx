// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('../lib/api', () => ({ api: { emergencyReadiness: vi.fn(), sendTestAlert: vi.fn() }, APIError: class extends Error { status = 0 } }))
import { api, APIError } from '../lib/api'
import { EmergencyReadinessCard } from './EmergencyReadinessCard'
import { ToastProvider } from './ui'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('EmergencyReadinessCard 应急就绪自检（假安心防护）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('完全无联系人（acceptedTotal=0）→ 明确警告"不会有人收到告警"', async () => {
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 0, acceptedReachable: 0, contacts: [] })
    render(<EmergencyReadinessCard />)
    expect(await screen.findByText(/不会有人收到告警/)).toBeInTheDocument()
  })

  it('有可达联系人但没指定紧急联系人 → **不**误报"无人被通知"，而是"联系人都会收到告警+建议指定"（修真警报 bug）', async () => {
    // 关键回归：SOS/摔倒告警扇给全体 accepted，故有可达联系人时绝不能说"无人会被通知"。
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 2, acceptedReachable: 2, contacts: [] })
    render(<EmergencyReadinessCard />)
    expect(await screen.findByText(/2 位联系人都会收到告警/)).toBeInTheDocument()
    expect(screen.getByText(/建议把最信任的人设为紧急联系人/)).toBeInTheDocument()
    expect(screen.queryByText(/不会有人收到告警/)).toBeNull() // 绝不再谎称无人被通知
  })

  it('有联系人但都不可达（acceptedReachable=0）→ danger"都收不到即时告警"', async () => {
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 2, acceptedReachable: 0, contacts: [] })
    render(<EmergencyReadinessCard />)
    expect(await screen.findByText(/都收不到即时告警/)).toBeInTheDocument()
  })

  it('紧急联系人全部可达 → ok 态"都能即时收到告警"，不列不可达者', async () => {
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: true, total: 2, reachable: 2, acceptedTotal: 2, acceptedReachable: 2,
      contacts: [{ name: '妈妈', relation: '家人', reachable: true }, { name: '老王', relation: '邻居', reachable: true }] })
    render(<EmergencyReadinessCard />)
    expect(await screen.findByText(/都能即时收到告警/)).toBeInTheDocument()
    expect(screen.queryByText(/收不到即时告警/)).toBeNull()
  })

  it('紧急联系人部分不可达 → danger 标明 N/M，逐个点出不可达者（可达的不列）', async () => {
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: true, total: 2, reachable: 1, acceptedTotal: 2, acceptedReachable: 1,
      contacts: [{ name: '妈妈', relation: '家人', reachable: true }, { name: '老王', relation: '邻居', reachable: false }] })
    render(<EmergencyReadinessCard />)
    expect(await screen.findByText(/只有 1 位能即时收到告警/)).toBeInTheDocument()
    expect(screen.getByText(/老王/)).toBeInTheDocument()       // 不可达者被点名
    expect(screen.getByText(/收不到即时告警/)).toBeInTheDocument()
    expect(screen.queryByText(/妈妈/)).toBeNull()               // 可达者不列（只列需处理的）
  })

  it('加载失败 → 整卡不渲染（绝不显示可能过时/错误的就绪状态，防假安心）', async () => {
    mock(api.emergencyReadiness).mockRejectedValue(new Error('boom'))
    const { container } = render(<EmergencyReadinessCard />)
    await waitFor(() => expect(api.emergencyReadiness).toHaveBeenCalled())
    expect(container.textContent).not.toContain('应急就绪')
  })

  it('有联系人 → 显示「发送测试告警」，确认后调 sendTestAlert；无联系人不显示该按钮', async () => {
    mock(api.emergencyReadiness).mockResolvedValueOnce({ hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 0, acceptedReachable: 0, contacts: [] })
    const { rerender, container } = render(<EmergencyReadinessCard refreshKey={1} />)
    await screen.findByText(/不会有人收到告警/)
    expect(screen.queryByRole('button', { name: '发送测试告警' })).toBeNull() // 无联系人：无从测起
    // 有联系人 → 按钮出现；确认后调 api。
    mock(api.emergencyReadiness).mockResolvedValueOnce({ hasEmergencyContact: true, total: 1, reachable: 1, acceptedTotal: 1, acceptedReachable: 1, contacts: [{ name: '妈妈', relation: '家人', reachable: true }] })
    mock(api.sendTestAlert).mockResolvedValue({ ok: true, notified: 1, contacts: 1 })
    rerender(<EmergencyReadinessCard refreshKey={2} />)
    const btn = await screen.findByRole('button', { name: '发送测试告警' })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(btn)
    await waitFor(() => expect(api.sendTestAlert).toHaveBeenCalled())
    confirmSpy.mockRestore()
    expect(container).toBeTruthy()
  })

  it('测试告警限流 429 → 明确提示"太频繁（每小时最多 3 次）"而非泛泛失败', async () => {
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: true, total: 1, reachable: 1, acceptedTotal: 1, acceptedReachable: 1, contacts: [{ name: '妈妈', relation: '家人', reachable: true }] })
    const err = new APIError('too_many_requests', 429); (err as { status: number }).status = 429
    mock(api.sendTestAlert).mockRejectedValue(err)
    render(<ToastProvider><EmergencyReadinessCard /></ToastProvider>) // 包 ToastProvider 才能断言 toast 文案
    const btn = await screen.findByRole('button', { name: '发送测试告警' })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(btn)
    await waitFor(() => expect(api.sendTestAlert).toHaveBeenCalled())
    expect(await screen.findByText(/测试太频繁/)).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('测试告警确认取消 → 不调 sendTestAlert（防误发骚扰联系人）', async () => {
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: true, total: 1, reachable: 1, acceptedTotal: 1, acceptedReachable: 1, contacts: [{ name: '妈妈', relation: '家人', reachable: true }] })
    render(<EmergencyReadinessCard />)
    const btn = await screen.findByRole('button', { name: '发送测试告警' })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false) // 用户取消
    fireEvent.click(btn)
    expect(api.sendTestAlert).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('refreshKey 变化 → 重新拉取（增删/设紧急联系人后就绪状态即时更新，不陈旧）', async () => {
    // 先无紧急联系人，后（父页设了紧急联系人 → refreshKey 变）返回全部可达。
    mock(api.emergencyReadiness)
      .mockResolvedValueOnce({ hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 0, acceptedReachable: 0, contacts: [] })
      .mockResolvedValueOnce({ hasEmergencyContact: true, total: 1, reachable: 1, acceptedTotal: 1, acceptedReachable: 1, contacts: [{ name: '妈妈', relation: '家人', reachable: true }] })
    const { rerender } = render(<EmergencyReadinessCard refreshKey={['a']} />)
    expect(await screen.findByText(/不会有人收到告警/)).toBeInTheDocument()
    rerender(<EmergencyReadinessCard refreshKey={['a', 'b']} />) // 新的联系人数组引用 → 重拉
    expect(await screen.findByText(/都能即时收到告警/)).toBeInTheDocument()
    expect(api.emergencyReadiness).toHaveBeenCalledTimes(2)
  })
})
