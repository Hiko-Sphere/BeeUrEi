// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmergencyAlertModal } from './EmergencyAlertHost'
import type { NotificationInfo } from '../../lib/api'

vi.mock('./CallController', () => ({ useCall: () => ({ active: null, startOutgoing: vi.fn() }) }))

function alert(data: Record<string, string>, createdAt = 1_700_000_000_000): NotificationInfo {
  return { id: 'n1', userId: 'me', kind: 'emergency_alert', title: '紧急：faller 可能需要帮助',
    body: 'App 检测到疑似摔倒。', data, createdAt, readAt: null } as unknown as NotificationInfo
}

describe('EmergencyAlertModal（告警模态展示）', () => {
  it('渲染标题/正文/回拨/确认；lastKnown 位置诚实标注"最后已知"', () => {
    const onAck = vi.fn(), onCall = vi.fn()
    render(<EmergencyAlertModal
      alert={alert({ fromId: 'u1', fromName: 'faller', lat: '31.2', lon: '121.5', locSource: 'lastKnown', locAgeSec: '120' })}
      othersCount={0} onAck={onAck} onCallBack={onCall} />)
    expect(screen.getByText('紧急：faller 可能需要帮助')).toBeInTheDocument()
    expect(screen.getByText('App 检测到疑似摔倒。')).toBeInTheDocument()
    // 诚实标注：兜底位置不得伪装成实时（图钉链接文案带"最后已知位置"）。
    expect(screen.getByRole('link', { name: /最后已知位置/ })).toHaveAttribute('href', expect.stringContaining('31.2,121.5'))
    // 一键导航前往（daddr 直接导航，赶去的家人少一步；承 iter323/324，收到 SOS 的模态最时间攸关）。
    expect(screen.getByRole('link', { name: /导航/ })).toHaveAttribute('href', expect.stringContaining('daddr=31.2,121.5'))
    // 回拨与确认可用。
    fireEvent.click(screen.getByText(/回拨/))
    expect(onCall).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('知道了'))
    expect(onAck).toHaveBeenCalledOnce()
  })

  it('实时坐标：位置链接为"查看位置"（不误标陈旧）；无 fromId 时不渲染回拨', () => {
    render(<EmergencyAlertModal
      alert={alert({ lat: '31.2', lon: '121.5', locSource: 'live' })}
      othersCount={2} onAck={() => {}} onCallBack={() => {}} />)
    expect(screen.getByRole('link', { name: /查看位置/ })).toBeInTheDocument() // 实时坐标：图钉链接标"查看位置"
    expect(screen.getByRole('link', { name: /导航/ })).toHaveAttribute('href', expect.stringContaining('daddr=')) // 导航前往
    expect(screen.queryByText(/回拨/)).toBeNull()          // 无 fromId → 无回拨按钮
    expect(screen.getByText(/还有 2 条/)).toBeInTheDocument() // 多条提示
  })

  it('无坐标：不渲染位置链接（告警仍可确认）', () => {
    render(<EmergencyAlertModal alert={alert({ fromId: 'u1', fromName: 'x' })} othersCount={0} onAck={() => {}} onCallBack={() => {}} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('知道了')).toBeInTheDocument()
  })

  it('beingHandled：显示"已有其他亲友在响应"协调提示；仍保留回拨/确认（不消模态）', () => {
    render(<EmergencyAlertModal alert={alert({ fromId: 'u1', fromName: 'faller' })} othersCount={0}
      beingHandled onAck={() => {}} onCallBack={() => {}} />)
    expect(screen.getByTestId('emergency-being-handled')).toBeInTheDocument()
    expect(screen.getByText(/已有其他亲友在响应/)).toBeInTheDocument()
    // 仍可回拨/确认——提示不剥夺本人继续帮忙的能力。
    expect(screen.getByText(/回拨/)).toBeInTheDocument()
    expect(screen.getByText('知道了')).toBeInTheDocument()
  })

  it('默认不显示协调提示（无人响应时）', () => {
    render(<EmergencyAlertModal alert={alert({ fromId: 'u1', fromName: 'x' })} othersCount={0} onAck={() => {}} onCallBack={() => {}} />)
    expect(screen.queryByTestId('emergency-being-handled')).toBeNull()
  })

  it('传入 onOnMyWay → 渲染"我在赶来"并点击调用它（遇险者据此知救援在途）；不传则不渲染', () => {
    const onWay = vi.fn()
    const { rerender } = render(<EmergencyAlertModal alert={alert({ fromId: 'u1', fromName: 'faller' })} othersCount={0}
      onAck={() => {}} onOnMyWay={onWay} onCallBack={() => {}} />)
    fireEvent.click(screen.getByText('我在赶来'))
    expect(onWay).toHaveBeenCalledOnce()
    // 不传 onOnMyWay → 该按钮不渲染（仅回拨/知道了），向后兼容。
    rerender(<EmergencyAlertModal alert={alert({ fromId: 'u1', fromName: 'faller' })} othersCount={0}
      onAck={() => {}} onCallBack={() => {}} />)
    expect(screen.queryByText('我在赶来')).toBeNull()
  })
})
