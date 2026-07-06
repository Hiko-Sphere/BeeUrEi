// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('react-router-dom', () => ({ Link: (p: { to: string; children: unknown }) => <a href={p.to}>{p.children as never}</a> }))
import { CallHistoryRow } from './CallHistoryRow'

const rec = (over: Record<string, unknown>) => ({ id: 'r', callId: 'c', direction: 'incoming', status: 'missed', peerId: 'p', peerName: '小明', peerAvatar: null, createdAt: 1_700_000_000_000, ...over })

describe('CallHistoryRow 紧急求助标记（未接紧急须显眼，提示优先回拨）', () => {
  it('emergency:true → 显示"🆘 紧急求助"徽标（读屏可闻）', () => {
    render(<ul><CallHistoryRow call={rec({ emergency: true })} /></ul>)
    expect(screen.getByText(/🆘 紧急求助/)).toBeInTheDocument()
  })
  it('emergency:false/缺省 → 不显示紧急徽标', () => {
    const { rerender } = render(<ul><CallHistoryRow call={rec({ emergency: false })} /></ul>)
    expect(screen.queryByText(/🆘/)).toBeNull()
    rerender(<ul><CallHistoryRow call={rec({})} /></ul>) // 缺 emergency 字段（旧数据）
    expect(screen.queryByText(/🆘/)).toBeNull()
  })
})
