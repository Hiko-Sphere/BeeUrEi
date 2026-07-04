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
    expect(api.contactMedicalInfo).not.toHaveBeenCalled()
  })

  it('点击 → 拉取并显示明文医疗信息', async () => {
    mock(api.contactMedicalInfo).mockResolvedValue({ medicalInfo: '血型 O；青霉素过敏', fromName: 'X', updatedAt: 1 })
    render(<ContactMedicalInfo userId="u1" />)
    fireEvent.click(screen.getByTestId('view-medical-btn'))
    expect(api.contactMedicalInfo).toHaveBeenCalledWith('u1')
    expect(await screen.findByTestId('medical-info-content')).toHaveTextContent('青霉素过敏')
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
})
