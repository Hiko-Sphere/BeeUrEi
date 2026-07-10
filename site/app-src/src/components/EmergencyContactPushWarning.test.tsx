// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../lib/webPush', () => ({ webPushSupported: vi.fn(), isWebPushSubscribed: vi.fn(), subscribeWebPush: vi.fn() }))
import { webPushSupported, isWebPushSubscribed, subscribeWebPush } from '../lib/webPush'
import { EmergencyContactPushWarning } from './EmergencyContactPushWarning'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('EmergencyContactPushWarning（自我版假安心：我是紧急联系人却没开通知）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('是紧急联系人 + 支持 + 未订阅 → 警告 + 点「开启通知」调 subscribeWebPush，成功后消失', async () => {
    mock(webPushSupported).mockReturnValue(true)
    mock(isWebPushSubscribed).mockResolvedValue(false)
    mock(subscribeWebPush).mockResolvedValue('subscribed')
    render(<EmergencyContactPushWarning emergencyFor={3} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/你是 3 位联系人的紧急联系人/)
    expect(alert).toHaveTextContent(/可能收不到 TA 的告警/)
    fireEvent.click(screen.getByRole('button', { name: '开启通知' }))
    await waitFor(() => expect(subscribeWebPush).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull()) // 订阅成功 → 警告消失
  })

  it('已订阅 → 不警告（不清扰）', async () => {
    mock(webPushSupported).mockReturnValue(true)
    mock(isWebPushSubscribed).mockResolvedValue(true)
    const { container } = render(<EmergencyContactPushWarning emergencyFor={3} />)
    await waitFor(() => expect(isWebPushSubscribed).toHaveBeenCalled())
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('不是任何人的紧急联系人（emergencyFor=0）→ 不警告（无责任无风险）', async () => {
    mock(webPushSupported).mockReturnValue(true)
    mock(isWebPushSubscribed).mockResolvedValue(false)
    const { container } = render(<EmergencyContactPushWarning emergencyFor={0} />)
    await waitFor(() => expect(isWebPushSubscribed).toHaveBeenCalled())
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('浏览器不支持 web-push → 不警告（无从开启，不误导）', async () => {
    mock(webPushSupported).mockReturnValue(false)
    const { container } = render(<EmergencyContactPushWarning emergencyFor={3} />)
    await waitFor(() => expect(webPushSupported).toHaveBeenCalled())
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(isWebPushSubscribed).not.toHaveBeenCalled()
  })
})
