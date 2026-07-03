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
    // 诚实标注：兜底位置不得伪装成实时（链接文案带"最后已知位置"）。
    expect(screen.getByRole('link').textContent).toContain('最后已知位置')
    expect(screen.getByRole('link')).toHaveAttribute('href', expect.stringContaining('31.2,121.5'))
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
    expect(screen.getByRole('link').textContent).toContain('查看位置')
    expect(screen.queryByText(/回拨/)).toBeNull()          // 无 fromId → 无回拨按钮
    expect(screen.getByText(/还有 2 条/)).toBeInTheDocument() // 多条提示
  })

  it('无坐标：不渲染位置链接（告警仍可确认）', () => {
    render(<EmergencyAlertModal alert={alert({ fromId: 'u1', fromName: 'x' })} othersCount={0} onAck={() => {}} onCallBack={() => {}} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('知道了')).toBeInTheDocument()
  })
})
