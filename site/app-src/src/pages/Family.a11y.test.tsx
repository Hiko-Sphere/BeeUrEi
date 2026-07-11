// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { axeViolations } from '../lib/axeCheck'

/// 亲友页无障碍门禁：Family 是协助端高流量页（联系人管理 + 紧急就绪 + 安全报到），此前不在 axe 门禁内。
/// 页面服务视障用户的亲友，图标按钮（呼叫/聊天/举报/设紧急）无 label、表单控件无名、aria 误用等回归必须挡在合并前。
/// axe 配置见 lib/axeCheck.ts（color-contrast/region 因 jsdom 限制禁用，其余全效）。独立文件：自带 mock，不扰共享 a11y 门禁。

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: (p: { to: string; children: unknown; className?: string; 'aria-label'?: string }) => <a href={p.to} className={p.className} aria-label={p['aria-label']}>{p.children as never}</a>,
}))
// 通话上下文（Family 用 useCall 接一键呼叫）——门禁只审静态可访问性，桩掉即可。
vi.mock('./call/CallController', () => ({ useCall: () => ({ active: null, startOutgoing: vi.fn() }) }))
// Web Push（EmergencyContactPushWarning 挂载即查订阅态）——jsdom 无 PushManager，桩成"不支持"走静态分支。
vi.mock('../lib/webPush', () => ({ webPushSupported: () => false, isWebPushSubscribed: vi.fn(), subscribeWebPush: vi.fn() }))
vi.mock('../lib/api', () => ({
  api: {
    familyLinks: vi.fn(), incomingLinks: vi.fn(), blocks: vi.fn(),
    safetyCheckin: vi.fn(), checkinSchedule: vi.fn(), checkinHistory: vi.fn(),
    emergencyReadiness: vi.fn(), emergencyHistory: vi.fn(),
    // 动作方法（挂载不触发，仅存在即可，防引用 undefined）：
    acceptLink: vi.fn(), addLink: vi.fn(), block: vi.fn(), unblock: vi.fn(), deleteLink: vi.fn(),
    setLinkEmergency: vi.fn(), startSafetyCheckin: vi.fn(), completeSafetyCheckin: vi.fn(),
    cancelSafetyCheckin: vi.fn(), extendSafetyCheckin: vi.fn(), setCheckinSchedule: vi.fn(),
    sendTestAlert: vi.fn(), lookupUser: vi.fn(),
  },
  APIError: class extends Error {},
  contentBlockedText: (_e: unknown, _t: unknown, fallback: string) => fallback,
}))
import { api } from '../lib/api'
import { FamilyPage } from './Family'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('Family 页无障碍门禁（axe 0 violations）', () => {
  it('联系人列表 + 待确认请求 + 拉黑名单 + 紧急就绪/安全报到卡：图标操作按钮均有可访问名，0 violations', async () => {
    mock(api.familyLinks).mockResolvedValue({ links: [
      { id: 'l1', memberId: 'm1', memberName: '小明', memberAvatar: null, relation: '朋友', isEmergency: true, amOwner: true, status: 'accepted', online: true },
    ] })
    mock(api.incomingLinks).mockResolvedValue({ links: [
      { id: 'i1', ownerId: 'o1', ownerName: '老王', ownerAvatar: null, relation: '家人', isEmergency: false, status: 'pending' },
    ] })
    mock(api.blocks).mockResolvedValue({ blocks: [{ id: 'b1', user: { id: 'x1', displayName: '被拉黑的人', avatar: null } }] })
    mock(api.safetyCheckin).mockResolvedValue({ timer: null, hasEmergencyContact: true, hasAnyContact: true })
    mock(api.checkinSchedule).mockResolvedValue({ schedule: null })
    mock(api.checkinHistory).mockResolvedValue({ history: [] })
    mock(api.emergencyHistory).mockResolvedValue({ history: [] })
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: true, total: 1, reachable: 1, acceptedTotal: 1, acceptedReachable: 1, contacts: [{ name: '小明', relation: '朋友', reachable: true }] })

    const { container, findByText } = render(<FamilyPage />)
    await findByText('小明')       // 等联系人列表渲染完（含呼叫/聊天/紧急/举报图标按钮）再审
    await findByText('老王')       // 待确认请求区
    await findByText('被拉黑的人')  // 拉黑名单区（解除拉黑按钮）
    expect(await axeViolations(container)).toEqual([])
  })
})
