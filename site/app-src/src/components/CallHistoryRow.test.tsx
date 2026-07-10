// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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

  it('传 onCall + peerId → 显示"呼叫"按钮，点击以该记录调用 onCall；callDisabled 时禁用', () => {
    const onCall = vi.fn()
    const r = rec({ peerId: 'p', peerName: '小明' })
    const { rerender } = render(<ul><CallHistoryRow call={r} onCall={onCall} /></ul>)
    fireEvent.click(screen.getByRole('button', { name: /呼叫 小明/ }))
    expect(onCall).toHaveBeenCalledWith(r) // 一键回拨对端（未接紧急求助尤需）
    // 通话进行中 → 按钮禁用（不能同时发起第二通）。
    rerender(<ul><CallHistoryRow call={r} onCall={onCall} callDisabled /></ul>)
    expect(screen.getByRole('button', { name: /呼叫 小明/ })).toBeDisabled()
  })

  it('接通且有 durationSec → 显示通话时长（3:24）；无/0 时长不显示', () => {
    const { rerender } = render(<ul><CallHistoryRow call={rec({ status: 'answered', durationSec: 204 })} /></ul>)
    expect(screen.getByText(/3:24/)).toBeInTheDocument()          // fmtDuration(204)=3:24
    rerender(<ul><CallHistoryRow call={rec({ status: 'answered', durationSec: 0 })} /></ul>)
    expect(screen.queryByText(/·\s*\d+:\d\d/)).toBeNull()        // 0 时长不显示
    rerender(<ul><CallHistoryRow call={rec({ status: 'missed' })} /></ul>) // 未接：无 durationSec
    expect(screen.queryByText(/·\s*\d+:\d\d/)).toBeNull()
  })

  it('不传 onCall → 无"呼叫"按钮（纯展示）；对端已注销(peerId=null)也不显示（无回拨对象）', () => {
    const { rerender } = render(<ul><CallHistoryRow call={rec({ peerId: 'p' })} /></ul>)
    expect(screen.queryByRole('button', { name: /呼叫/ })).toBeNull()
    rerender(<ul><CallHistoryRow call={rec({ peerId: null })} onCall={vi.fn()} /></ul>)
    expect(screen.queryByRole('button', { name: /呼叫/ })).toBeNull()
  })
})
