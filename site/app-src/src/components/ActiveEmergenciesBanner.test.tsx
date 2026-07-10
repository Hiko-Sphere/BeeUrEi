// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../lib/api', () => ({ api: { watchingEmergencies: vi.fn(), emergencyAck: vi.fn(), contactMedicalInfo: vi.fn() }, APIError: class extends Error { status = 0 } }))
import { api } from '../lib/api'
import { ActiveEmergenciesBanner } from './ActiveEmergenciesBanner'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const ev = (over: Record<string, unknown> = {}) => ({ ownerId: 'mom', ownerName: '妈妈', eventId: 'e1', kind: 'fall', at: Date.now() - 60000, acked: false, escalated: false, lat: 31.2, lon: 121.4, hasMedical: false, ...over })

describe('ActiveEmergenciesBanner 我负责的人活跃紧急（漏看推送兜底）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('有活跃紧急 → role=alert 置顶，列出人名/类型/位置链接；点「呼叫」调 onCall', async () => {
    mock(api.watchingEmergencies).mockResolvedValue({ active: [ev()] })
    const onCall = vi.fn()
    render(<ActiveEmergenciesBanner onCall={onCall} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('妈妈')
    expect(alert).toHaveTextContent('疑似摔倒')
    expect(screen.getByRole('link', { name: '位置' })).toHaveAttribute('href', expect.stringContaining('maps'))
    fireEvent.click(screen.getByRole('button', { name: /呼叫/ }))
    expect(onCall).toHaveBeenCalledWith('mom', '妈妈')
  })

  it('点「我在赶来」→ emergencyAck(ownerId, eventId, onMyWay=true)，按钮变「已回应」', async () => {
    mock(api.watchingEmergencies).mockResolvedValue({ active: [ev()] })
    mock(api.emergencyAck).mockResolvedValue({})
    render(<ActiveEmergenciesBanner />)
    fireEvent.click(await screen.findByRole('button', { name: '我在赶来' }))
    await waitFor(() => expect(api.emergencyAck).toHaveBeenCalledWith('mom', 'e1', true))
    expect(await screen.findByRole('button', { name: '已回应' })).toBeDisabled()
  })

  it('该人有医疗信息(hasMedical) → 显示醒目"点击查看医疗信息"按钮；无则不显示（施救刚需）', async () => {
    mock(api.watchingEmergencies).mockResolvedValue({ active: [ev({ hasMedical: true })] })
    mock(api.contactMedicalInfo).mockResolvedValue({ medicalInfo: 'O型血 · 青霉素过敏', updatedAt: Date.now() })
    render(<ActiveEmergenciesBanner />)
    const medBtn = await screen.findByTestId('view-medical-btn')
    expect(medBtn).toHaveTextContent(/此人有紧急医疗信息/)         // emphasize 醒目态
    fireEvent.click(medBtn)
    await waitFor(() => expect(api.contactMedicalInfo).toHaveBeenCalledWith('mom'))
    expect(await screen.findByText(/青霉素过敏/)).toBeInTheDocument() // 拉取到并展示
  })

  it('该人无医疗信息(hasMedical=false) → 不显示医疗信息按钮（不越权拉取/不清扰）', async () => {
    mock(api.watchingEmergencies).mockResolvedValue({ active: [ev({ hasMedical: false })] })
    render(<ActiveEmergenciesBanner />)
    await screen.findByText('妈妈')
    expect(screen.queryByTestId('view-medical-btn')).toBeNull()
    expect(api.contactMedicalInfo).not.toHaveBeenCalled()
  })

  it('无活跃紧急 → 整块不渲染（只在需要行动时出现）', async () => {
    mock(api.watchingEmergencies).mockResolvedValue({ active: [] })
    const { container } = render(<ActiveEmergenciesBanner />)
    await waitFor(() => expect(api.watchingEmergencies).toHaveBeenCalled())
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('升级后仍无人响应（escalated∧!acked）→ 显示"升级后仍无人响应"标', async () => {
    mock(api.watchingEmergencies).mockResolvedValue({ active: [ev({ escalated: true, acked: false })] })
    render(<ActiveEmergenciesBanner />)
    expect(await screen.findByText(/升级后仍无人响应/)).toBeInTheDocument()
  })

  it('已有人响应（acked）→ 显示"有人响应"标', async () => {
    mock(api.watchingEmergencies).mockResolvedValue({ active: [ev({ escalated: true, acked: true })] })
    render(<ActiveEmergenciesBanner />)
    expect(await screen.findByText(/有人响应/)).toBeInTheDocument()
  })
})
