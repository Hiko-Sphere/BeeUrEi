// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../lib/api', () => ({ api: { emergencyReadiness: vi.fn() }, APIError: class extends Error {} }))
import { api } from '../lib/api'
import { EmergencyReadinessCard } from './EmergencyReadinessCard'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('EmergencyReadinessCard 应急就绪自检（假安心防护）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('无紧急联系人 → 明确警告"出事时不会有人收到告警"', async () => {
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: false, total: 0, reachable: 0, contacts: [] })
    render(<EmergencyReadinessCard />)
    expect(await screen.findByText(/不会有人收到告警/)).toBeInTheDocument()
  })

  it('全部可达 → ok 态"都能即时收到告警"，不列不可达者', async () => {
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: true, total: 2, reachable: 2,
      contacts: [{ name: '妈妈', relation: '家人', reachable: true }, { name: '老王', relation: '邻居', reachable: true }] })
    render(<EmergencyReadinessCard />)
    expect(await screen.findByText(/都能即时收到告警/)).toBeInTheDocument()
    expect(screen.queryByText(/收不到即时告警/)).toBeNull()
  })

  it('部分不可达 → danger 态标明 N/M，且逐个点出不可达的联系人（可达的不列）', async () => {
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: true, total: 2, reachable: 1,
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
})
