// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

/// IncomingCallHost（全局来电轮询宿主，曾 0% 覆盖）：盲人/亲友定向呼叫在 web 端的**唯一**
/// 前台会合机制（不依赖推送）。弹铃时机错了=来电无声错过；不收铃=幽灵铃误导接听。
const presentRing = vi.fn()
const dismissRingIfGone = vi.fn()
let activeCall: object | null = null
vi.mock('./CallController', () => ({ useCall: () => ({ active: activeCall, presentRing, dismissRingIfGone }) }))
vi.mock('../../lib/api', () => ({ api: { incomingCalls: vi.fn() } }))
import { api } from '../../lib/api'
import { IncomingCallHost } from './IncomingCallHost'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const flush = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  activeCall = null
  mock(api.incomingCalls).mockResolvedValue({ calls: [] })
})
afterEach(() => vi.useRealTimers())

describe('IncomingCallHost 来电会合', () => {
  it('轮询发现针对本人的来电 → 弹铃（透传 callId/来电人/紧急标志）', async () => {
    mock(api.incomingCalls).mockResolvedValue({ calls: [{ callId: 'c1', fromName: '妈妈', fromAvatar: null, emergency: false }] })
    render(<IncomingCallHost />)
    await flush(0) // 挂载即查一次
    expect(presentRing).toHaveBeenCalledWith({ callId: 'c1', fromName: '妈妈', fromAvatar: null, emergency: false })
  })

  it('多路并发来电：**紧急求助先响**（不是先到先响）', async () => {
    mock(api.incomingCalls).mockResolvedValue({ calls: [
      { callId: 'c-normal', fromName: '普通呼叫', fromAvatar: null, emergency: false },
      { callId: 'c-sos', fromName: '李奶奶', fromAvatar: null, emergency: true },
    ] })
    render(<IncomingCallHost />)
    await flush(0)
    expect(presentRing).toHaveBeenCalledWith(expect.objectContaining({ callId: 'c-sos', emergency: true }))
  })

  it('通话中不弹新来电铃（不打断正在进行的协助）；但仍持续收敛已消失的铃', async () => {
    activeCall = { callId: 'ongoing' }
    mock(api.incomingCalls).mockResolvedValue({ calls: [{ callId: 'c2', fromName: '张三', fromAvatar: null, emergency: false }] })
    render(<IncomingCallHost />)
    await flush(0)
    expect(presentRing).not.toHaveBeenCalled()
    expect(dismissRingIfGone).toHaveBeenCalledWith(new Set(['c2'])) // 收敛逻辑照常喂当前 id 集
  })

  it('来电消失（被取消/他人接听）→ 用空集收铃，且不再弹铃', async () => {
    mock(api.incomingCalls).mockResolvedValue({ calls: [{ callId: 'c3', fromName: '王五', fromAvatar: null, emergency: false }] })
    render(<IncomingCallHost />)
    await flush(0)
    expect(presentRing).toHaveBeenCalledTimes(1)
    mock(api.incomingCalls).mockResolvedValue({ calls: [] })
    await flush(3000) // 下一轮
    expect(dismissRingIfGone).toHaveBeenLastCalledWith(new Set())
    expect(presentRing).toHaveBeenCalledTimes(1) // 没新来电不重复弹
  })

  it('网络抖动（本轮抛错）不打断轮询：下一轮恢复即弹铃', async () => {
    mock(api.incomingCalls).mockRejectedValueOnce(new Error('offline'))
    render(<IncomingCallHost />)
    await flush(0)
    expect(presentRing).not.toHaveBeenCalled()
    mock(api.incomingCalls).mockResolvedValue({ calls: [{ callId: 'c4', fromName: '恢复后', fromAvatar: null, emergency: false }] })
    await flush(3000)
    expect(presentRing).toHaveBeenCalledWith(expect.objectContaining({ callId: 'c4' }))
  })
})
