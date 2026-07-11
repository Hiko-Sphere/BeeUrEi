// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { NotificationInfo } from '../../lib/api'

// startOutgoing 可控返回：模拟"呼叫成功发起" vs "被守则卡/已有通话/注册失败挡下"。
const startOutgoing = vi.fn()
vi.mock('./CallController', () => ({ useCall: () => ({ active: null, startOutgoing }) }))
// playEmergencyChime 播放音频（jsdom 无 Audio）→ mock 掉；其余 emergencyAlerts 纯函数保真。
vi.mock('../../lib/emergencyAlerts', async (orig) => ({ ...(await orig() as object), playEmergencyChime: vi.fn() }))
vi.mock('../../lib/api', () => ({
  api: {
    notifications: vi.fn(),
    markNotifRead: vi.fn().mockResolvedValue({}),
    emergencyAck: vi.fn().mockResolvedValue({}),
    contactMedicalInfo: vi.fn(),
  },
  APIError: class extends Error {},
}))
import { api } from '../../lib/api'
import { EmergencyAlertHost } from './EmergencyAlertHost'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const alertNotif = (): NotificationInfo => ({
  id: 'a1', userId: 'me', kind: 'emergency_alert', title: '紧急：张三可能需要帮助', body: '疑似摔倒',
  data: { type: 'emergency_alert', kind: 'fall', fromId: 'u1', fromName: '张三', eventId: 'e1' },
  createdAt: Date.now(), readAt: null,
} as unknown as NotificationInfo)

describe('EmergencyAlertHost 紧急回拨（先拨通才算已确认）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock(api.notifications).mockResolvedValue({ notifications: [alertNotif()] })
  })

  it('回拨被挡（startOutgoing 返 false：已有通话/守则未接受/注册失败）→ **不标已读**，SOS 保留不被静默清除', async () => {
    startOutgoing.mockResolvedValue(false)
    render(<EmergencyAlertHost />)
    await waitFor(() => expect(screen.getByTestId('emergency-alert-modal')).toBeInTheDocument())
    fireEvent.click(screen.getByText(/回拨/))
    await waitFor(() => expect(startOutgoing).toHaveBeenCalled())
    expect(api.markNotifRead).not.toHaveBeenCalled()   // 呼叫未发起 → 绝不标已读（此前会先 ack 再失败→SOS 丢失）
    expect(api.emergencyAck).not.toHaveBeenCalled()
  })

  it('回拨成功（startOutgoing 返 true）→ 标已读+回告发起人（视为已确认）', async () => {
    startOutgoing.mockResolvedValue(true)
    render(<EmergencyAlertHost />)
    await waitFor(() => expect(screen.getByTestId('emergency-alert-modal')).toBeInTheDocument())
    fireEvent.click(screen.getByText(/回拨/))
    await waitFor(() => expect(api.markNotifRead).toHaveBeenCalled())
    expect(api.emergencyAck).toHaveBeenCalled()
  })
})
