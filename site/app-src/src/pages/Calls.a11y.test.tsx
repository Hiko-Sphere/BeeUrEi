// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axeViolations } from '../lib/axeCheck'

/// 通话页无障碍门禁：Calls 是协助端的**来电/求助队列 + 通话记录 + 未接紧急回拨**页，此前不在 axe 门禁内。
/// 服务视障用户的亲友（本身也可能有障碍）——接听/认领/回拨/加载更多等图标操作无可访问名，会让读屏亲友
/// 在有人求助时无法响应。axe 配置见 lib/axeCheck.ts（color-contrast/region 因 jsdom 限制禁用，其余全效）。

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: (p: { to: string; children: unknown; className?: string; 'aria-label'?: string }) => <a href={p.to} className={p.className} aria-label={p['aria-label']}>{p.children as never}</a>,
}))
vi.mock('./call/CallController', () => ({
  useCall: () => ({ answerIncoming: vi.fn(), claimQueue: vi.fn(), active: null, startOutgoing: vi.fn() }),
}))
vi.mock('../lib/api', () => ({
  api: {
    incomingCalls: vi.fn(), helpQueue: vi.fn(), callHistory: vi.fn(), helpMatch: vi.fn(),
  },
  APIError: class extends Error {},
}))
import { api } from '../lib/api'
import { CallsPage } from './Calls'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('Calls 页无障碍门禁（axe 0 violations）', () => {
  it('来电 + 求助队列 + 通话记录（含未接/已拒/回拨）：图标操作均有可访问名，0 violations', async () => {
    mock(api.incomingCalls).mockResolvedValue({ calls: [
      { callId: 'c1', fromId: 'u1', fromName: '小明', fromAvatar: null, emergency: true, at: Date.now() },
    ] })
    mock(api.helpQueue).mockResolvedValue({ requests: [
      { callId: 'q1', fromUserId: 'u2', fromName: '小红', fromAvatar: null, topic: '过马路', locality: '南京西路', language: 'zh', createdAt: Date.now() - 1000 },
    ] })
    mock(api.callHistory).mockResolvedValue({ calls: [
      { id: 'h1', callId: 'x1', direction: 'incoming', status: 'missed', peerId: 'u3', peerName: '老王', peerAvatar: null, createdAt: Date.now() - 2000 },
      { id: 'h2', callId: 'x2', direction: 'outgoing', status: 'answered', peerId: 'u4', peerName: '阿姨', peerAvatar: null, createdAt: Date.now() - 3000 },
      { id: 'h3', callId: 'x3', direction: 'incoming', status: 'declined', peerId: null, peerName: '已注销用户', peerAvatar: null, createdAt: Date.now() - 4000 },
    ], hasMore: false })
    const { container } = render(<CallsPage />)
    await screen.findByText('小明')
    expect(await axeViolations(container)).toEqual([])
  })

  it('空态（无来电/队列/记录）也 0 violations', async () => {
    mock(api.incomingCalls).mockResolvedValue({ calls: [] })
    mock(api.helpQueue).mockResolvedValue({ requests: [] })
    mock(api.callHistory).mockResolvedValue({ calls: [], hasMore: false })
    const { container } = render(<CallsPage />)
    await new Promise((r) => setTimeout(r, 0))
    expect(await axeViolations(container)).toEqual([])
  })
})
