// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { CallProvider, useCall } from './CallController'

// registerCall 慢一拍（一个可控的挂起 promise），模拟 setActive 之前的网络往返窗口——并发第二通须被闩挡住。
let resolveRegister: (() => void) | null = null
const registerCall = vi.fn(() => new Promise<void>((r) => { resolveRegister = r }))
// answeredCall 结果可配（youWon/gone/别人先接三态各自措辞是被测不变量）。
let answeredResult: { youWon: boolean; gone?: boolean } = { youWon: true }
const answeredCall = vi.fn(() => Promise.resolve(answeredResult))
const declineCall = vi.fn().mockResolvedValue(undefined)
const cancelCall = vi.fn().mockResolvedValue(undefined)
// toast 捕获：三态措辞断言靠它（不同结果给用户不同、且**如实**的话）。
const toasts: string[] = []

vi.mock('../../lib/api', () => ({
  api: {
    me: vi.fn().mockResolvedValue({ helperGuidelineAckAt: '2026-01-01' }), // 已 ack 守则：ensureGuideline 不弹卡
    registerCall: () => registerCall(), // 只验调用次数，不转发实参
    claimHelp: vi.fn().mockResolvedValue(undefined),
    answeredCall: () => answeredCall(),
    guidelineAck: vi.fn().mockResolvedValue(undefined),
    cancelCall: (id: string) => cancelCall(id),
    declineCall: (id: string) => declineCall(id),
  },
  callErrorText: () => 'err',
}))
vi.mock('../../lib/i18n', () => ({ useI18n: () => ({ t: (zh: string) => zh, lang: 'zh' }) }))
vi.mock('../../components/ui', () => ({
  useToast: () => (msg: string) => { toasts.push(msg) },
  Modal: (p: { children?: unknown }) => p.children as never,
  Avatar: () => null,
  Button: (p: { children?: unknown }) => p.children as never,
}))
vi.mock('../../components/icons', () => ({ IconPhone: () => null, IconX: () => null }))
vi.mock('./CallScreen', () => ({ CallScreen: () => null })) // 不拉起真 WebRTC

let ctx: ReturnType<typeof useCall> | null = null
function Grab() { ctx = useCall(); return null }

describe('CallController 单通闩：并发启动只注册一通', () => {
  beforeEach(() => { registerCall.mockClear(); answeredCall.mockClear(); resolveRegister = null; ctx = null })

  it('并发两次 startOutgoing（setActive 前有 await 窗口）只注册一通', async () => {
    render(<CallProvider><Grab /></CallProvider>)
    const start = ctx!.startOutgoing
    await act(async () => {
      // 同一（初次渲染的）闭包连发两次——真实场景：第一通 registerCall 未回、尚未 setActive/重渲染时又点了一下。
      void start('u1', 'A')
      void start('u2', 'B')
      await Promise.resolve() // 让两次都跑过入口守卫与首个 await
    })
    // 第二通被 startingRef 闩挡住：registerCall 只应发生一次（修复前会两次→孤立一个 callId）。
    expect(registerCall).toHaveBeenCalledTimes(1)
    await act(async () => { resolveRegister?.(); await Promise.resolve() })
  })

  it('放行后闩复位，可再发起下一通', async () => {
    render(<CallProvider><Grab /></CallProvider>)
    await act(async () => { void ctx!.answerIncoming('c1', 'A'); await Promise.resolve() })
    // answeredCall 立即 resolve → setActive；此时应有 active，后续入口守卫改由 active 挡。
    expect(answeredCall).toHaveBeenCalledTimes(1)
  })
})

describe('来电铃：紧急求助突出显示（施救者优先应答）', () => {
  beforeEach(() => { ctx = null })

  it('emergency:true → alertdialog aria-label 含"紧急求助来电" + 🆘 文案', () => {
    const r = render(<CallProvider><Grab /></CallProvider>)
    act(() => { ctx!.presentRing({ callId: 'sos-1', fromName: '小明', emergency: true }) })
    const dialog = r.getByRole('alertdialog')
    expect(dialog.getAttribute('aria-label')).toContain('紧急求助来电')
    expect(r.container.textContent).toContain('🆘 紧急求助')
  })

  it('普通来电（emergency:false）→ 无紧急样式/文案', () => {
    const r = render(<CallProvider><Grab /></CallProvider>)
    act(() => { ctx!.presentRing({ callId: 'reg-1', fromName: '阿姨', emergency: false }) })
    expect(r.getByRole('alertdialog').getAttribute('aria-label')).not.toContain('紧急')
    expect(r.container.textContent).not.toContain('🆘')
  })
})

describe('answerIncoming 三态措辞（如实告知，绝不误报"被别人接听"）', () => {
  beforeEach(() => { ctx = null; toasts.length = 0; answeredCall.mockClear(); answeredResult = { youWon: true } })

  it('youWon → 进入通话（active 置位），无误导 toast', async () => {
    render(<CallProvider><Grab /></CallProvider>)
    answeredResult = { youWon: true }
    await act(async () => { await ctx!.answerIncoming('c1', '小明') })
    expect(ctx!.active).toMatchObject({ callId: 'c1', kind: 'incoming', peerName: '小明' })
    expect(toasts).toEqual([]) // 胜出不弹任何提示
  })

  it('gone（呼叫已过期/取消）→ "这通来电已结束"，绝不说"被别人接听"（无人接≠别人接）', async () => {
    render(<CallProvider><Grab /></CallProvider>)
    answeredResult = { youWon: false, gone: true }
    await act(async () => { await ctx!.answerIncoming('c2', '阿姨') })
    expect(ctx!.active).toBeNull()
    expect(toasts).toContain('这通来电已结束')
    expect(toasts.join()).not.toContain('其他亲友') // 关键：不误报
  })

  it('别人先接（!youWon 且 !gone）→ "已被其他亲友接听"', async () => {
    render(<CallProvider><Grab /></CallProvider>)
    answeredResult = { youWon: false }
    await act(async () => { await ctx!.answerIncoming('c3', '叔叔') })
    expect(ctx!.active).toBeNull()
    expect(toasts).toContain('已被其他亲友接听')
  })
})

describe('来电铃抑制与收敛（不在通话中弹新铃；来电消失即收铃）', () => {
  beforeEach(() => { ctx = null; toasts.length = 0; answeredResult = { youWon: true } })

  it('通话进行中 presentRing 被抑制（不打断当前通话）', async () => {
    const r = render(<CallProvider><Grab /></CallProvider>)
    await act(async () => { await ctx!.answerIncoming('ongoing', '甲') }) // 先进通话
    expect(ctx!.active).not.toBeNull()
    act(() => { ctx!.presentRing({ callId: 'new-ring', fromName: '乙', emergency: false }) })
    expect(r.queryByRole('alertdialog')).toBeNull() // 通话中不弹新铃
  })

  it('dismissRingIfGone：当前铃的 callId 已不在集合 → 收铃；仍在 → 保留', () => {
    const r = render(<CallProvider><Grab /></CallProvider>)
    act(() => { ctx!.presentRing({ callId: 'ring-x', fromName: '甲', emergency: false }) })
    expect(r.getByRole('alertdialog')).toBeTruthy()
    act(() => { ctx!.dismissRingIfGone(new Set(['other'])) }) // ring-x 不在集合
    expect(r.queryByRole('alertdialog')).toBeNull()
  })

  it('presentRing：已有铃时不被后续 present 覆盖（首个来电稳定显示，不被并发轮询刷替）', () => {
    const r = render(<CallProvider><Grab /></CallProvider>)
    act(() => { ctx!.presentRing({ callId: 'first', fromName: '首个', emergency: false }) })
    act(() => { ctx!.presentRing({ callId: 'second', fromName: '后到', emergency: false }) })
    expect(r.container.textContent).toContain('首个')
    expect(r.container.textContent).not.toContain('后到')
  })
})
