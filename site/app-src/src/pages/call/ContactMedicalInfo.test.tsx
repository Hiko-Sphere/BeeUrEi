// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// mock api：控制 contactMedicalInfo 的返回；APIError 供组件按 status 分支。
vi.mock('../../lib/api', () => ({
  api: { contactMedicalInfo: vi.fn() },
  APIError: class extends Error { code: string; status: number; constructor(code: string, status: number) { super(code); this.code = code; this.status = status } },
}))
import { api, APIError } from '../../lib/api'
import { ContactMedicalInfo } from './EmergencyAlertHost'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('ContactMedicalInfo（施救时按需查看遇险者医疗信息）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('默认只显示按钮，不自动拉取（敏感数据点击才请求）', () => {
    render(<ContactMedicalInfo userId="u1" />)
    expect(screen.getByTestId('view-medical-btn')).toBeInTheDocument()
    expect(screen.getByTestId('view-medical-btn')).toHaveTextContent('查看紧急医疗信息')
    expect(api.contactMedicalInfo).not.toHaveBeenCalled()
  })

  it('emphasize（告警带 hasMedical）→ 醒目提示"此人有紧急医疗信息，点击查看"', () => {
    render(<ContactMedicalInfo userId="u1" emphasize />)
    expect(screen.getByTestId('view-medical-btn')).toHaveTextContent('此人有紧急医疗信息')
    expect(api.contactMedicalInfo).not.toHaveBeenCalled() // 仍点击才拉取
  })

  it('点击 → 拉取并显示明文医疗信息', async () => {
    mock(api.contactMedicalInfo).mockResolvedValue({ medicalInfo: '血型 O；青霉素过敏', fromName: 'X', updatedAt: 1 })
    render(<ContactMedicalInfo userId="u1" />)
    fireEvent.click(screen.getByTestId('view-medical-btn'))
    expect(api.contactMedicalInfo).toHaveBeenCalledWith('u1')
    expect(await screen.findByTestId('medical-info-content')).toHaveTextContent('青霉素过敏')
  })

  it('显示医疗信息的更新时间（施救者据此判断是否可能过时）；updatedAt 为 null 时不显示', async () => {
    mock(api.contactMedicalInfo).mockResolvedValue({ medicalInfo: '哮喘，随身带沙丁胺醇', fromName: 'X', updatedAt: Date.now() - 3 * 86400_000 })
    render(<ContactMedicalInfo userId="u1" />)
    fireEvent.click(screen.getByTestId('view-medical-btn'))
    const content = await screen.findByTestId('medical-info-content')
    expect(content).toHaveTextContent('哮喘')
    expect(content).toHaveTextContent(/更新于/) // 更新时间可见（死字段修复）
  })

  it('updatedAt 为 null（旧数据/未记录）→ 不显示更新时间，仍显示医疗信息', async () => {
    mock(api.contactMedicalInfo).mockResolvedValue({ medicalInfo: '无已知过敏', fromName: 'X', updatedAt: null })
    render(<ContactMedicalInfo userId="u1" />)
    fireEvent.click(screen.getByTestId('view-medical-btn'))
    const content = await screen.findByTestId('medical-info-content')
    expect(content).toHaveTextContent('无已知过敏')
    expect(content).not.toHaveTextContent('更新于')
  })

  it('403（非紧急联系人）→ 提示仅紧急联系人可查看', async () => {
    mock(api.contactMedicalInfo).mockRejectedValue(new APIError('forbidden', 403))
    render(<ContactMedicalInfo userId="u1" />)
    fireEvent.click(screen.getByTestId('view-medical-btn'))
    await waitFor(() => expect(screen.getByTestId('medical-info-msg')).toHaveTextContent(/仅.*紧急联系人/))
  })

  it('404（对方未填）→ 提示未填写', async () => {
    mock(api.contactMedicalInfo).mockRejectedValue(new APIError('no_medical_info', 404))
    render(<ContactMedicalInfo userId="u1" />)
    fireEvent.click(screen.getByTestId('view-medical-btn'))
    await waitFor(() => expect(screen.getByTestId('medical-info-msg')).toHaveTextContent(/未填写/))
  })

  it('换人(userId 变)即复位：绝不残留上一人的医疗信息（急救错数据防护）', async () => {
    mock(api.contactMedicalInfo).mockResolvedValueOnce({ medicalInfo: 'A型血 · 青霉素过敏', updatedAt: 1 })
    // rerender **不带 key**（复用同一实例）→ 专门验证组件自身的 userId 变化复位（key 保障在调用点另测）。
    const { rerender } = render(<ContactMedicalInfo userId="personA" emphasize />)
    fireEvent.click(screen.getByTestId('view-medical-btn'))
    await waitFor(() => expect(screen.getByTestId('medical-info-content')).toHaveTextContent('青霉素过敏'))
    // 切到第二位遇险者：必须复位为按钮，A 的医疗信息一个字都不能残留。
    rerender(<ContactMedicalInfo userId="personB" emphasize />)
    expect(screen.queryByTestId('medical-info-content')).toBeNull()
    expect(screen.queryByText(/青霉素过敏/)).toBeNull()
    expect(screen.getByTestId('view-medical-btn')).toBeInTheDocument()
  })
})
