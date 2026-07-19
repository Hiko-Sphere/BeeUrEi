// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// 强制英文渲染：未读计数的单复数病语只在英文串（中文"还有 N 条"无复数）。othersCount=1 时须"1 more unread
// emergency alert"（单数），此前硬编码 "alert(s)" 是偷懒——紧急告警是最高风险 UI，语法须正确（"行业内最顶尖"）。
vi.mock('../../lib/i18n', () => ({ useI18n: () => ({ lang: 'en', t: (_zh: string, en: string) => en, setLang: () => {} }) }))
vi.mock('./CallController', () => ({ useCall: () => ({ active: null, startOutgoing: vi.fn() }) }))
import { EmergencyAlertModal } from './EmergencyAlertHost'
import type { NotificationInfo } from '../../lib/api'

function alert(data: Record<string, string>): NotificationInfo {
  return { id: 'n1', userId: 'me', kind: 'emergency_alert', title: 'x', body: 'y', data, createdAt: 1_700_000_000_000, readAt: null } as unknown as NotificationInfo
}

describe('EmergencyAlertModal 英文未读计数单复数（最高风险 UI 也须语法正确）', () => {
  it('othersCount=1 → "1 more unread emergency alert"（单数，非 alert(s)）', () => {
    render(<EmergencyAlertModal alert={alert({ lat: '31.2', lon: '121.5', locSource: 'live' })}
      othersCount={1} onAck={() => {}} onCallBack={() => {}} />)
    expect(screen.getByText('1 more unread emergency alert in Alerts')).toBeInTheDocument()
    expect(screen.queryByText(/emergency alerts /)).toBeNull() // 绝不复数
  })

  it('othersCount=2 → "2 more unread emergency alerts"（复数）', () => {
    render(<EmergencyAlertModal alert={alert({ lat: '31.2', lon: '121.5', locSource: 'live' })}
      othersCount={2} onAck={() => {}} onCallBack={() => {}} />)
    expect(screen.getByText('2 more unread emergency alerts in Alerts')).toBeInTheDocument()
  })
})
