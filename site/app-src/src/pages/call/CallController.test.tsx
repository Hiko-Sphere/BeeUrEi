// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { CallProvider, useCall } from './CallController'

// registerCall 慢一拍（一个可控的挂起 promise），模拟 setActive 之前的网络往返窗口——并发第二通须被闩挡住。
let resolveRegister: (() => void) | null = null
const registerCall = vi.fn(() => new Promise<void>((r) => { resolveRegister = r }))
const answeredCall = vi.fn(() => Promise.resolve({ youWon: true }))

vi.mock('../../lib/api', () => ({
  api: {
    me: vi.fn().mockResolvedValue({ helperGuidelineAckAt: '2026-01-01' }), // 已 ack 守则：ensureGuideline 不弹卡
    registerCall: () => registerCall(), // 只验调用次数，不转发实参
    claimHelp: vi.fn().mockResolvedValue(undefined),
    answeredCall: () => answeredCall(),
    guidelineAck: vi.fn().mockResolvedValue(undefined),
    cancelCall: vi.fn().mockResolvedValue(undefined),
  },
  callErrorText: () => 'err',
}))
vi.mock('../../lib/i18n', () => ({ useI18n: () => ({ t: (zh: string) => zh, lang: 'zh' }) }))
vi.mock('../../components/ui', () => ({
  useToast: () => vi.fn(),
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
