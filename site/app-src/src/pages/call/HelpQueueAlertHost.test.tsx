// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

/// HelpQueueAlertHost（求助队列声音提示宿主，曾 0% 覆盖）：待命志愿者停在别的页面时，
/// 队列新求助靠它出声引路——不响=盲人在队列干等到超时；乱响=志愿者关掉待命（狼来了）。
/// pickNewHelpRequests（去重核心）保持**真实**，只桩出声（jsdom 无 AudioContext）与 context。
const toastSpy = vi.fn()
let activeCall: object | null = null
vi.mock('./CallController', () => ({ useCall: () => ({ active: activeCall }) }))
vi.mock('../../components/ui', () => ({ useToast: () => toastSpy }))
vi.mock('../../lib/helpQueueAlert', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/helpQueueAlert')>()
  return { ...actual, playHelpChime: vi.fn() }
})
vi.mock('../../lib/api', () => ({ api: { helpQueue: vi.fn() } }))
import { api } from '../../lib/api'
import { playHelpChime } from '../../lib/helpQueueAlert'
import { HelpQueueAlertHost } from './HelpQueueAlertHost'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const flush = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const req = (id: string, over?: Record<string, unknown>) => ({ id, fromName: '李奶奶', topic: '', createdAt: 1000, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  activeCall = null
  localStorage.setItem('beeurei.web.available', '1') // 默认待命
  mock(api.helpQueue).mockResolvedValue({ requests: [] })
})
afterEach(() => { vi.useRealTimers(); localStorage.clear() })

describe('HelpQueueAlertHost 求助队列声音提示', () => {
  it('待命中出现新求助 → 出声 + toast 指引去通话页（单条含来电人与话题）', async () => {
    mock(api.helpQueue).mockResolvedValue({ requests: [req('h1', { topic: '读药品说明' })] })
    render(<HelpQueueAlertHost />)
    await flush(0) // 挂载即查：已有排队者立刻提示（他们正在等）
    expect(playHelpChime).toHaveBeenCalledTimes(1)
    expect(toastSpy).toHaveBeenCalledWith('新的求助：李奶奶（读药品说明）——请到通话页接听')
  })

  it('多条新求助 → 汇总一条 toast（不连环轰炸）；同一求助跨轮不重复响铃', async () => {
    mock(api.helpQueue).mockResolvedValue({ requests: [req('h1'), req('h2', { fromName: '王爷爷' })] })
    render(<HelpQueueAlertHost />)
    await flush(0)
    expect(playHelpChime).toHaveBeenCalledTimes(1)
    expect(toastSpy).toHaveBeenCalledWith('有 2 条新的求助等待接听——请到通话页查看')
    await flush(12_000) // 下一轮同样两条还挂着
    expect(playHelpChime).toHaveBeenCalledTimes(1) // 已提示过：不再响（防狼来了）
    expect(toastSpy).toHaveBeenCalledTimes(1)
  })

  it('未待命：**不拉队列也不出声**（明确表示不接单的人不被打扰，也不白耗请求）', async () => {
    localStorage.setItem('beeurei.web.available', '0')
    mock(api.helpQueue).mockResolvedValue({ requests: [req('h1')] })
    render(<HelpQueueAlertHost />)
    await flush(12_000)
    expect(api.helpQueue).not.toHaveBeenCalled()
    expect(playHelpChime).not.toHaveBeenCalled()
  })

  it('通话中不打扰（正在协助的人不被响铃）', async () => {
    activeCall = { callId: 'ongoing' }
    mock(api.helpQueue).mockResolvedValue({ requests: [req('h1')] })
    render(<HelpQueueAlertHost />)
    await flush(12_000)
    expect(api.helpQueue).not.toHaveBeenCalled()
    expect(playHelpChime).not.toHaveBeenCalled()
  })

  it('陈旧响应丢弃（复审#2）：慢响应的空快照不得抹掉已提示集合——否则下轮同一求助重复响铃', async () => {
    // tick1 发起后悬住（将返回 30s 前的空快照）；tick2 返回 h1 并响铃。
    let resolveStale: ((v: { requests: unknown[] }) => void) | null = null
    mock(api.helpQueue).mockImplementationOnce(() => new Promise((r) => { resolveStale = r }))
    render(<HelpQueueAlertHost />)
    await flush(0) // tick1 悬在途中
    mock(api.helpQueue).mockResolvedValue({ requests: [req('h1')] })
    await flush(12_000) // tick2：h1 首次提示
    expect(playHelpChime).toHaveBeenCalledTimes(1)
    await act(async () => { resolveStale!({ requests: [] }) }) // 陈旧空快照此刻才回来
    await flush(12_000) // tick3：h1 仍在队列
    expect(playHelpChime).toHaveBeenCalledTimes(1) // 若陈旧快照抹掉集合，这里会第二次响铃（回归即红）
  })
})
