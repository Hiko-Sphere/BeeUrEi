// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

/// React Admin 总览的危机信号卡（与 vanilla 面板同源同口径——此前 React 版全部缺席，
/// 只看这页的运维会漏掉正在发生的危机：活跃紧急/无人触达/磁盘告急/邮件故障/中继不可达）。
vi.mock('../lib/api', () => ({ api: { adminOverview: vi.fn() } }))
import { api } from '../lib/api'
import { AdminPage } from './Admin'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const GiB = 1024 ** 3

const baseOverview = {
  users: { total: 14, active: 13, disabled: 1, byRole: { blind: 4, helper: 8, family: 2 } },
  online: { total: 3, helpers: 2 },
  reports: { open: 0, total: 5 },
  recordings: { total: 1, config: { enabled: true, requireConsent: true } },
  growth: { newUsers7d: 2, newUsers30d: 6, trend: [{ date: '2026-07-11', count: 1 }, { date: '2026-07-12', count: 1 }] },
  version: '0.1.0', uptimeSeconds: 3600, nowMs: Date.now(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mock(api.adminOverview).mockResolvedValue(baseOverview)
})

describe('Admin 总览危机信号（React 版补齐 vanilla 面板 parity）', () => {
  it('一切正常：零危机卡（不摆空 alert 区）；磁盘健康时常显余量卡', async () => {
    mock(api.adminOverview).mockResolvedValue({ ...baseOverview, activeEmergencies: 0, activeUnreachable: 0, mail: { sent: 9, failed: 0 }, callConnect: { relayUnreachable: 0, generic: 0, signaling: 0 }, safetyTickErrors: 0, disk: { freeBytes: 57 * GiB, totalBytes: 100 * GiB, low: false } })
    render(<AdminPage />)
    expect(await screen.findByText('用户总数')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull() // 无危机=无 alert 区，绝不"常红"麻痹
    expect(screen.getByText('磁盘余量')).toBeInTheDocument()
    expect(screen.getByText('57.0 GB')).toBeInTheDocument() // 余量常在视野里
  })

  it('危机置顶：活跃紧急/无人触达/磁盘告急/邮件失败/中继不可达 各自亮 danger 卡（role=alert）', async () => {
    mock(api.adminOverview).mockResolvedValue({
      ...baseOverview,
      activeEmergencies: 2, activeUnreachable: 1,
      disk: { freeBytes: 1.5 * GiB, totalBytes: 100 * GiB, low: true },
      mail: { sent: 9, failed: 3 },
      callConnect: { relayUnreachable: 4, generic: 1, signaling: 0 },
      safetyTickErrors: 2,
    })
    render(<AdminPage />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('正在进行的紧急')
    expect(alert.textContent).toContain('紧急·无人可触达')
    expect(alert.textContent).toContain('安全网正静默失效')
    expect(alert.textContent).toContain('磁盘余量告急')
    expect(alert.textContent).toContain('1.5 GB (2%)')
    expect(alert.textContent).toContain('邮件发送失败')
    expect(alert.textContent).toContain('通话中继不可达')
    expect(alert.textContent).toContain('报到后台错误')
    expect(screen.queryByText('磁盘余量', { exact: true })).toBeNull() // 告急时不再重复普通余量卡
  })

  it('旧服务端（无新字段）：总览照常渲染，不炸不显危机区（向后兼容）', async () => {
    render(<AdminPage />) // baseOverview 不含任何新字段
    expect(await screen.findByText('用户总数')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('磁盘余量')).toBeNull() // 无数据=诚实缺席，不编造
  })
})
