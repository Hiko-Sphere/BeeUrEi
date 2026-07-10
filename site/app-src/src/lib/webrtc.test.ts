// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./config', () => ({ wsURL: (p: string) => 'ws://test' + p }))
vi.mock('./api', () => ({ api: { reportCallFailure: vi.fn(() => Promise.resolve({ ok: true })), reportCallDuration: vi.fn(() => Promise.resolve({ ok: true })) }, uploadMedia: vi.fn(), APIError: class extends Error {} }))

import { CallEngine, isRelayCandidate, hasTurnServer, iceFailureDiagnostic } from './webrtc'

/// ICE 失败诊断的纯函数（把 TURN 静默失效变成可感知信号）：候选串解析 / TURN 配置探测 / 失败归因。
describe('ICE 失败诊断纯函数', () => {
  it('isRelayCandidate：仅 typ relay 判 true；host/srflx/relayed-substring 不误判', () => {
    expect(isRelayCandidate('candidate:4 1 UDP 92 10.0.0.1 55000 typ relay raddr 1.2.3.4 rport 3478')).toBe(true)
    expect(isRelayCandidate('candidate:1 1 UDP 21 192.168.1.2 5000 typ host')).toBe(false)
    expect(isRelayCandidate('candidate:2 1 UDP 16 1.2.3.4 5000 typ srflx raddr 192.168.1.2 rport 5000')).toBe(false)
    expect(isRelayCandidate('candidate:9 1 UDP 5 5.6.7.8 5000 typ relayed')).toBe(false) // "relayed"≠"relay"，须词边界
    expect(isRelayCandidate('candidate:9 1 UDP 5 5.6.7.8 5000 typ relay')).toBe(true)     // 行尾也算
  })
  it('hasTurnServer：turn:/turns: 判 true（含 urls 数组、大小写、STUN-only 判 false）', () => {
    expect(hasTurnServer([{ urls: 'stun:stun.l.google.com:19302' }])).toBe(false)
    expect(hasTurnServer([{ urls: 'turn:1.2.3.4:3478' }])).toBe(true)
    expect(hasTurnServer([{ urls: ['stun:s:3478', 'TURNS:1.2.3.4:5349'] }])).toBe(true) // 大小写不敏感、数组
    expect(hasTurnServer([])).toBe(false)
  })
  it('iceFailureDiagnostic：配了 TURN 却无 relay 候选 → relayUnreachable；其余 → generic', () => {
    expect(iceFailureDiagnostic({ turnConfigured: true, relaySeen: false })).toBe('relayUnreachable')
    expect(iceFailureDiagnostic({ turnConfigured: true, relaySeen: true })).toBe('generic')  // 有 relay 候选=TURN 可达，失败另有因
    expect(iceFailureDiagnostic({ turnConfigured: false, relaySeen: false })).toBe('generic') // 只配 STUN：失败属预期，不诬指 TURN
  })
})

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

// ICE 重连状态恢复：disconnected 喷 'reconnecting'，ICE 自行恢复后须喷回 'connected'——
// 否则顶部横幅永久卡"正在重连…"（onStatus('connected') 首连只喷一次、无人喷回），通话早已恢复盲人却一直被告知重连中。
describe('CallEngine ICE 重连横幅恢复', () => {
  const engineWithStatus = (statuses: string[]) => new CallEngine({
    callId: 'c1', token: 'T', iceServers: [],
    recordPolicy: { enabled: false, requireConsent: false },
    cb: { onStatus: (k) => statuses.push(k) },
  }) as unknown as { onIceState: (s: string) => void; stopStats: () => void }

  it('disconnected→reconnecting，恢复 connected→喷回 connected 清横幅', () => {
    const statuses: string[] = []
    const e = engineWithStatus(statuses)
    e.onIceState('disconnected')
    expect(statuses).toContain('reconnecting')
    statuses.length = 0
    e.onIceState('connected')            // ICE 自愈
    expect(statuses).toContain('connected') // 主动清"重连中"横幅
    e.stopStats()                        // 清 startStats 起的定时器
  })

  it('未经历 disconnected 的 connected 不喷 onStatus(connected)（不覆盖首连/ peerVideoOn 等）', () => {
    const statuses: string[] = []
    const e = engineWithStatus(statuses)
    e.onIceState('connected')            // 首次连上，从未 disconnected
    expect(statuses).not.toContain('connected') // 无横幅可清，不多喷（首连的 connected 由数据面单独喷）
    e.stopStats()
  })
})

// ICE 失败时区分「TURN 不可达」与普通失败并喷不同状态（onIceState 端到端接线，非仅纯函数）。
describe('CallEngine ICE 失败诊断喷 relayUnreachable', () => {
  const engineWith = (iceServers: RTCIceServer[]) => {
    const statuses: string[] = []
    const e = new CallEngine({
      callId: 'c1', token: 'T', iceServers,
      recordPolicy: { enabled: false, requireConsent: false },
      cb: { onStatus: (k) => statuses.push(k) },
    }) as unknown as { onIceState: (s: string) => void; relayCandidateSeen: boolean }
    return { e, statuses }
  }
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {})) // 静音诊断 warn
  afterEach(() => vi.restoreAllMocks())

  it('配了 TURN 但全程无 relay 候选 → 喷 relayUnreachable（且 warn），不喷 mediaFailed', async () => {
    const { api } = await import('./api')
    ;(api.reportCallFailure as ReturnType<typeof vi.fn>).mockClear()
    const { e, statuses } = engineWith([{ urls: 'turn:1.2.3.4:3478' }])
    e.onIceState('failed')
    expect(statuses).toContain('relayUnreachable')
    expect(statuses).not.toContain('mediaFailed')
    expect(console.warn).toHaveBeenCalled()
    expect(api.reportCallFailure).toHaveBeenCalledWith('relay_unreachable', 'c1') // 上报可观测
    e.onIceState('failed') // 再次 failed → 上报去重，仍只一次
    expect((api.reportCallFailure as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('配了 TURN 且见过 relay 候选 → 普通 mediaFailed（TURN 可达，失败另有因）', () => {
    const { e, statuses } = engineWith([{ urls: 'turn:1.2.3.4:3478' }])
    ;(e as unknown as { relayCandidateSeen: boolean }).relayCandidateSeen = true
    e.onIceState('failed')
    expect(statuses).toContain('mediaFailed')
    expect(statuses).not.toContain('relayUnreachable')
  })

  it('仅 STUN（未配 TURN）失败 → 普通 mediaFailed（不诬指 TURN 故障）', () => {
    const { e, statuses } = engineWith([{ urls: 'stun:stun.l.google.com:19302' }])
    e.onIceState('failed')
    expect(statuses).toContain('mediaFailed')
    expect(statuses).not.toContain('relayUnreachable')
  })
})

// 录制混音上下文也需 resume：suspended 态 AudioContext 不跑音频图，MediaStreamSource→Destination 混音不流动，
// 录下来的音频静音（同 chime/铃声的 suspended 坑，那三处已 resume、此处曾漏）。录制是知情同意的取证留存，静音=证据损毁。
describe('CallEngine 录制混音上下文 resume', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('buildRecordStream 对混音 AudioContext 显式 resume（防 suspended 静音录制）', () => {
    const resume = vi.fn(() => Promise.resolve())
    class MockAudioCtx {
      resume = resume
      createMediaStreamDestination() { return { stream: { getAudioTracks: () => [{ kind: 'audio' }] } } }
      createMediaStreamSource() { return { connect: (n: unknown) => n } }
      close() { return Promise.resolve() }
    }
    vi.stubGlobal('AudioContext', MockAudioCtx)
    class FakeStream {
      tracks: { kind: string }[]
      constructor(tracks: { kind: string }[] = []) { this.tracks = tracks }
      addTrack(t: { kind: string }) { this.tracks.push(t) }
      getTracks() { return this.tracks }
      getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video') }
      getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio') }
    }
    vi.stubGlobal('MediaStream', FakeStream)

    const engine = new CallEngine({ callId: 'c1', token: 'T', iceServers: [], recordPolicy: { enabled: false, requireConsent: false }, cb: {} })
    const e = engine as unknown as { remoteStream: FakeStream; localStream: FakeStream | null; buildRecordStream: () => unknown }
    e.remoteStream = new FakeStream([{ kind: 'video' }, { kind: 'audio' }])
    e.localStream = new FakeStream([{ kind: 'audio' }])
    e.buildRecordStream()
    expect(resume).toHaveBeenCalled() // 关键：混音上下文也 resume，否则 suspended 态录出静音
  })
})

describe('CallEngine 挂断上报通话时长（connectedAt→duration）', () => {
  const engineFor = () => new CallEngine({
    callId: 'c1', token: 'T', iceServers: [],
    recordPolicy: { enabled: false, requireConsent: false }, cb: {},
  }) as unknown as { onIceState: (s: string) => void; hangUp: () => void }
  beforeEach(async () => { const { api } = await import('./api'); (api.reportCallDuration as ReturnType<typeof vi.fn>).mockClear() })

  it('真连通过(onIceState connected)后 hangUp → 上报 reportCallDuration(callId, 秒数)', async () => {
    const { api } = await import('./api')
    const e = engineFor()
    e.onIceState('connected')  // 设 connectedAt
    e.hangUp()
    expect(api.reportCallDuration).toHaveBeenCalledWith('c1', expect.any(Number))
  })

  it('从未连通 → hangUp 不上报（0 时长无意义，避免污染未接/失败通话记录）', async () => {
    const { api } = await import('./api')
    const e = engineFor()
    e.hangUp()  // 未经历 onIceState('connected')
    expect(api.reportCallDuration).not.toHaveBeenCalled()
  })

  it('重复 hangUp → 只上报一次（ended 守卫）', async () => {
    const { api } = await import('./api')
    const e = engineFor()
    e.onIceState('connected')
    e.hangUp(); e.hangUp()
    expect((api.reportCallDuration as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })
})
