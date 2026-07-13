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
    expect(screen.getByRole('link', { name: /位置/ })).toHaveAttribute('href', expect.stringContaining('maps'))
    fireEvent.click(screen.getByRole('button', { name: /呼叫/ }))
    expect(onCall).toHaveBeenCalledWith('mom', '妈妈')
  })

  it('位置旁有「导航前往」链接（daddr 直接导航，赶去的家人少一步）', async () => {
    mock(api.watchingEmergencies).mockResolvedValue({ active: [ev()] })
    render(<ActiveEmergenciesBanner />)
    const dir = await screen.findByRole('link', { name: /导航/ })
    expect(dir).toHaveAttribute('href', expect.stringContaining('daddr=31.2,121.4'))
  })

  it('实时坐标（locSource!=lastKnown）→ 位置链接标"📍 位置"、无陈旧警示', async () => {
    mock(api.watchingEmergencies).mockResolvedValue({ active: [ev({ locSource: 'live' })] })
    render(<ActiveEmergenciesBanner />)
    const link = await screen.findByRole('link', { name: /位置/ })
    expect(link.textContent).toContain('📍')
    expect(link.textContent).not.toContain('⚠️')
    expect(link).not.toHaveAttribute('title') // 实时无"最后已知"悬停说明
  })

  it('兜底「最后已知」坐标 → 诚实标注 ⚠️最后位置·定位时刻（协助者不照旧坐标扑空）；title 给绝对时刻', async () => {
    // 告警发出于 10 分钟前(at)，定位早于告警 600s → 定位绝对时刻 = at - 600s。
    const at = Date.now() - 10 * 60_000
    mock(api.watchingEmergencies).mockResolvedValue({ active: [ev({ at, locSource: 'lastKnown', locAgeSec: 600 })] })
    render(<ActiveEmergenciesBanner />)
    const link = await screen.findByRole('link', { name: /最后位置/ })
    expect(link.textContent).toContain('⚠️')          // 陈旧警示图标
    expect(link).toHaveAttribute('title')             // 悬停给"定位于 HH:MM"绝对时刻
    expect(link).toHaveAttribute('href', expect.stringContaining('maps')) // 仍可点看地图（旧坐标也比没有强，但如实标）
  })

  it('点「我在赶来」→ emergencyAck(ownerId, eventId, onMyWay=true)，两按钮收起为「已回应」状态', async () => {
    mock(api.watchingEmergencies).mockResolvedValue({ active: [ev()] })
    mock(api.emergencyAck).mockResolvedValue({})
    render(<ActiveEmergenciesBanner />)
    fireEvent.click(await screen.findByRole('button', { name: '我在赶来' }))
    await waitFor(() => expect(api.emergencyAck).toHaveBeenCalledWith('mom', 'e1', true))
    // 回应后两个回应按钮收起为状态标（不再是可重复点的按钮）。
    await waitFor(() => expect(screen.getByText(/已回应/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '我在赶来' })).toBeNull()
    expect(screen.queryByRole('button', { name: '我已看到' })).toBeNull()
  })

  it('点「我已看到」→ emergencyAck(ownerId, eventId, onMyWay=false)——去不了的亲友也能停升级+告知有人响应，不必谎称"在赶来"', async () => {
    mock(api.watchingEmergencies).mockResolvedValue({ active: [ev()] })
    mock(api.emergencyAck).mockResolvedValue({})
    render(<ActiveEmergenciesBanner />)
    fireEvent.click(await screen.findByRole('button', { name: '我已看到' }))
    await waitFor(() => expect(api.emergencyAck).toHaveBeenCalledWith('mom', 'e1', false)) // onMyWay=false（纯 ack）
    await waitFor(() => expect(screen.getByText(/已回应/)).toBeInTheDocument())
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

  it('已有人响应（acked 但未上路）→ 显示"有人响应"标', async () => {
    mock(api.watchingEmergencies).mockResolvedValue({ active: [ev({ escalated: true, acked: true })] })
    render(<ActiveEmergenciesBanner />)
    expect(await screen.findByText('有人响应')).toBeInTheDocument()
  })

  it('有人正在赶来（onWay）→ 显示"有人正在赶来"（比"有人响应"更强的安心信号），且不再只显"有人响应"', async () => {
    mock(api.watchingEmergencies).mockResolvedValue({ active: [ev({ acked: true, onWay: true })] })
    render(<ActiveEmergenciesBanner />)
    expect(await screen.findByText('有人正在赶来')).toBeInTheDocument()
    expect(screen.queryByText('有人响应')).toBeNull() // onWay 时用更强措辞，不并列显弱的
  })
})
