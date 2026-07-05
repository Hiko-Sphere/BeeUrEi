// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./config', () => ({ wsURL: (p: string) => 'ws://test' + p }))
vi.mock('./api', () => ({ api: {}, uploadMedia: vi.fn(), APIError: class extends Error {} }))

import { CallEngine } from './webrtc'

/// CallEngine 的 start()「越过 getUserMedia 后被挂断」守卫（复审 HIGH）：
/// 若在 getUserMedia 在途期间 hangUp/卸载（此时 pc/ws 尚为 null，hangUp 关不掉任何东西、只置 ended），
/// start() 恢复后必须**早退**——绝不再建 PeerConnection/WebSocket，并停掉已拿到的麦克风轨——
/// 否则会泄漏一个无人引用的活 PC + 麦克风采集 + 已 join 房间的信令 ws（直到标签页关闭）。
describe('CallEngine.start ended-guard', () => {
  let pcCtor: ReturnType<typeof vi.fn>
  let wsCtor: ReturnType<typeof vi.fn>
  let trackStops: number
  let resolveGUM: (s: unknown) => void
  const track = () => ({ enabled: true, stop: () => { trackStops += 1 } })
  const fakeStream = () => { const t = track(); return { getTracks: () => [t], getAudioTracks: () => [t] } }

  beforeEach(() => {
    trackStops = 0
    pcCtor = vi.fn(() => ({ addTrack: vi.fn(), close: vi.fn(), set ontrack(_v: unknown) {}, set onicecandidate(_v: unknown) {}, set oniceconnectionstatechange(_v: unknown) {} }))
    wsCtor = vi.fn(() => ({ set onopen(_v: unknown) {}, set onmessage(_v: unknown) {}, set onclose(_v: unknown) {}, close: vi.fn(), readyState: 0, send: vi.fn() }))
    ;(globalThis as unknown as { MediaStream: unknown }).MediaStream = class { addTrack() {} getTracks() { return [] } getAudioTracks() { return [] } }
    ;(globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = pcCtor
    ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = wsCtor
    const gum = new Promise((r) => { resolveGUM = r })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(() => gum) }, configurable: true,
    })
  })
  afterEach(() => { vi.restoreAllMocks() })

  const makeEngine = () => new CallEngine({
    callId: 'c1', token: 'T', iceServers: [],
    recordPolicy: { enabled: false, requireConsent: false }, cb: {},
  })

  it('挂断发生在 getUserMedia 在途时：不建 PC/ws，且停掉已拿到的麦克风轨', async () => {
    const engine = makeEngine()
    const p = engine.start()          // 悬停在 getUserMedia
    engine.hangUp()                   // 此刻 pc/ws 还是 null，只置 ended
    resolveGUM(fakeStream())          // getUserMedia 现在才解析
    await p
    expect(pcCtor).not.toHaveBeenCalled()   // 绝不建 PeerConnection
    expect(wsCtor).not.toHaveBeenCalled()   // 绝不建/加入信令 ws
    expect(trackStops).toBe(1)              // 已拿到的麦克风轨被停（不泄漏采集）
  })

  it('正常路径（未挂断）：建出 PC 与 ws（守卫只影响被挂断的路径，不误伤正常连接）', async () => {
    const engine = makeEngine()
    const p = engine.start()
    resolveGUM(fakeStream())          // 未 hangUp
    await p
    expect(pcCtor).toHaveBeenCalledTimes(1)
    expect(wsCtor).toHaveBeenCalledTimes(1)
    expect(trackStops).toBe(0)        // 正常路径不停轨
  })
})

// 旁观(合规监看)ICE 候选缓冲：只对已建的旁观 PC 缓冲；伪造/陌生 peer 的 obs-ice 直接丢弃，
// 防恶意参与者狂发 obs-ice 把 observerPending 无界撑爆（内存），也杜绝为不存在的 PC 缓冲候选。
describe('CallEngine 旁观 ICE 缓冲边界', () => {
  const makeEngine = () => new CallEngine({
    callId: 'c1', token: 'T', iceServers: [],
    recordPolicy: { enabled: false, requireConsent: false }, cb: {},
  })

  it('陌生/伪造 peer 的 obs-ice（无对应旁观 PC）不缓冲', () => {
    const e = makeEngine() as unknown as { addObserverCandidate: (p: string, c: unknown) => void; observerPending: Map<string, unknown[]> }
    e.addObserverCandidate('stranger', { candidate: 'x' })
    e.addObserverCandidate('stranger', { candidate: 'y' })
    expect(e.observerPending.size).toBe(0) // 无 PC → 丢弃，绝不堆积
  })

  it('已建旁观 PC 且远端未到时 obs-ice 正常缓冲（不误伤合法握手）', () => {
    const e = makeEngine() as unknown as { addObserverCandidate: (p: string, c: unknown) => void; observerPCs: Map<string, unknown>; observerPending: Map<string, unknown[]> }
    e.observerPCs.set('admin', {}) // 模拟已建旁观 PC（服务端核验过的管理员）
    e.addObserverCandidate('admin', { candidate: 'x' })
    expect(e.observerPending.get('admin')?.length).toBe(1) // 合法缓冲仍生效
  })
})
