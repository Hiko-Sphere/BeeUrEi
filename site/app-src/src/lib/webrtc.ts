// 协助者侧 WebRTC 通话引擎（浏览器）。镜像 iOS 的 MediaEngine + SignalingClient + CallViewModel 的
// **协助者(helper)语义**：本端只发麦克风音频，接收视障侧的视频 + 双向语音；可远程控制手电筒/变焦；
// 可响应/发起录制知情同意握手；并以与 1:1 主通道隔离的额外 PeerConnection 配合管理员合规旁观
// （把本端语音推给管理员、播放管理员语音——参与方必知情）。
//
// 信令协议与服务端 /ws（src/routes/ws.ts）严格一致：join / offer / answer / ice / video-gate /
// control / record-request / record-consent / record-state / end / peer-left / obs-offer / obs-answer / obs-ice。
import { wsURL } from './config'
import { api, uploadMedia, APIError } from './api'

export type MediaState = 'connecting' | 'connected' | 'failed' | 'disconnected'
export type Quality = 'unknown' | 'weak' | 'fair' | 'good'

/// 由候选对往返时延(秒)判定通话质量档：无 rtt→unknown；<150ms→good；<400ms→fair；否则 weak
/// （含 NaN——保守归为 weak，不虚报好信号）。抽成纯函数便于单测：阈值直接决定盲人听到的
/// "信号良好/一般/弱"（见 CallScreen QualityBars），回归须挡住。
export function qualityFromRtt(rtt: number | undefined): Quality {
  if (rtt === undefined) return 'unknown'
  return rtt < 0.15 ? 'good' : rtt < 0.4 ? 'fair' : 'weak'
}

/// 区间丢包率(0..1)判定质量档：<3%→good；<8%→fair；否则 weak。无数据/非有限→unknown（不降级）。
/// 丢包是通话可听度的**主导因素**：RTT 再低，8% 丢包也让语音断续、盲人听不清导航指引。
export function qualityFromLoss(lossFraction: number | undefined): Quality {
  if (lossFraction === undefined || !Number.isFinite(lossFraction)) return 'unknown'
  const f = Math.max(0, lossFraction)
  return f < 0.03 ? 'good' : f < 0.08 ? 'fair' : 'weak'
}

/// 抖动(秒，inbound-rtp.jitter=RFC3550 到达间隔抖动)判定质量档：<30ms→good；<60ms→fair；否则 weak。
/// 无数据/非有限→unknown（不降级）。抖动大=到达时刻忽快忽慢，抖动缓冲要么加延迟要么放空=语音断续，
/// 即便**丢包与 RTT 都不高**也会卡（MOS 三要素里独立的一维），故并入综合判定。
export function qualityFromJitter(jitterSeconds: number | undefined): Quality {
  if (jitterSeconds === undefined || !Number.isFinite(jitterSeconds)) return 'unknown'
  const j = Math.max(0, jitterSeconds)
  return j < 0.03 ? 'good' : j < 0.06 ? 'fair' : 'weak'
}

/// 综合通话质量：**取 RTT / 丢包 / 抖动三档中最差的一档**（行业通例——MOS 同时受时延、丢包、抖动
/// 拖累，任一变差都直接影响可听度）。任一信号缺失(unknown)时以其余有信息者为准；全缺才 unknown。
/// 抽成纯函数便于单测；丢包区间率与抖动由 Call.pollStats 从 inbound-rtp 采样后喂入（jitter 可选，向后兼容）。
export function qualityFromStats(rtt: number | undefined, lossFraction: number | undefined, jitterSeconds?: number): Quality {
  const rank: Record<Quality, number> = { unknown: -1, good: 0, fair: 1, weak: 2 }
  const cands = [qualityFromRtt(rtt), qualityFromLoss(lossFraction), qualityFromJitter(jitterSeconds)]
  return cands.reduce((worst, q) => (rank[q] >= rank[worst] ? q : worst), 'unknown' as Quality) // 取最差；unknown(-1) 天然让位
}

/// 通话信号"该不该向读屏播报"的判定（与 iOS 核心 CallQualityAnnouncer 同语义，跨端一致）：
/// 协助端 web 的盲人用户（web 与 App 功能对齐）此前只有 QualityBars 的静态 aria-label——信号掉了不会被**主动**
/// 播报，得手动导航到那组条形才知道。iOS 靠 CallQualityAnnouncer 语音说"信号弱、换个位置"，web 应对齐（读屏
/// aria-live）。规则：只播**进入弱**与**从弱恢复**（fair↔good 之间不表态，不可行动、只会成噪音）；状态翻转需
/// **连续确认** confirmations 次（默认 2，web 每 2s 一采样≈4s 才播，抵御 RTT 抖动的"弱/好/弱"刷屏）；
/// unknown 中性不表态也不清累积；已播状态不重复。
export class CallQualityAnnouncer {
  private announcedWeak = false
  private pendingWeak: boolean | null = null
  private pendingCount = 0
  private readonly confirmations: number
  constructor(confirmations = 2) { this.confirmations = confirmations } // 不用参数属性：web 构建 erasableSyntaxOnly 禁用

  /// 喂入最新信号档，返回需播报的语义（'weak' 转弱 / 'recovered' 恢复 / null 无需播）。
  update(quality: Quality): 'weak' | 'recovered' | null {
    if (quality === 'unknown') return null // 无数据：中性，保留正在累积的确认
    const isWeak = quality === 'weak'
    if (isWeak === this.announcedWeak) { this.pendingWeak = null; this.pendingCount = 0; return null } // 与已播一致：稳定，清累积
    if (this.pendingWeak === isWeak) this.pendingCount++
    else { this.pendingWeak = isWeak; this.pendingCount = 1 }
    if (this.pendingCount < this.confirmations) return null
    this.announcedWeak = isWeak; this.pendingWeak = null; this.pendingCount = 0
    return isWeak ? 'weak' : 'recovered'
  }
}

export interface CallPeer { userId?: string; name?: string; avatar?: string | null }

export interface CallCallbacks {
  onStatus?(text: 'connecting' | 'connected' | 'peerVideoOn' | 'signalingClosed' | 'mediaFailed' | 'reconnecting'): void
  onConnected?(connected: boolean): void
  onPeer?(peer: CallPeer): void
  onMediaState?(s: MediaState): void
  onRemoteStream?(stream: MediaStream): void
  onPeerVideoGate?(on: boolean): void
  onQuality?(q: Quality): void
  onAdminObserving?(info: { observing: boolean; name?: string | null }): void
  onPeerRecording?(on: boolean): void
  onRecordRequest?(): void
  onRecordConsentResult?(accepted: boolean): void
  onRecordingStateChange?(recording: boolean): void
  onRecordingError?(reason: string): void
  onLastRecordingId?(id: string): void
  onMicDenied?(): void
  onEnded?(reason: 'peer' | 'admin' | 'signaling'): void
  /// 通话内实时文字（RTT）：收到对端文本 / 本端文本被服务端拒绝（rejected 带原因与回显 id）。
  /// fromAdmin：旁观管理员发的介入文字（气泡须如实归属，不得与对端混同）。
  onCallText?(m: { text: string; from?: string; at?: number; fromAdmin: boolean }): void
  onCallTextRejected?(reason: string, id?: string): void
}

/// 通话内文本客户端约束（与服务端 ws.ts 同口径：trim 后非空且 ≤500 字）。
export const CALL_TEXT_MAX = 500
export function validCallText(text: string): string | null {
  const t = text.trim()
  return t && t.length <= CALL_TEXT_MAX ? t : null
}

/// 服务端拒绝回执 reason → 用户文案（与 chatErrorText/callErrorText 同风格：给可行动的话，不念原始码）。
export function callTextRejectText(reason: string, t: (zh: string, en: string) => string): string {
  switch (reason) {
    case 'content_blocked': return t('消息包含违禁内容，未发送', 'Message contains blocked content — not sent')
    case 'rate_limited': return t('发送太快了，请稍等片刻再发', 'Sending too fast — wait a moment and retry')
    default: return t('消息无效，未发送', 'Invalid message — not sent')
  }
}

interface EngineOpts {
  callId: string
  token: string
  iceServers: RTCIceServer[]
  recordPolicy: { enabled: boolean; requireConsent: boolean }
  cb: CallCallbacks
}

type Msg = { type?: string;[k: string]: unknown }

export class CallEngine {
  private readonly callId: string
  private readonly token: string
  private readonly iceServers: RTCIceServer[]
  private readonly recordPolicy: { enabled: boolean; requireConsent: boolean }
  private readonly cb: CallCallbacks

  private ws: WebSocket | null = null
  private pc: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteStream = new MediaStream()
  private hasRemoteDesc = false
  private pendingCandidates: RTCIceCandidateInit[] = []
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private prevPackets?: { received: number; lost: number } // 上一轮累计收/丢包数，用于算区间丢包率
  private iceWasReconnecting = false // ICE 曾进入 disconnected（喷过 'reconnecting'）→ 恢复时须主动喷回 'connected' 清横幅
  private ended = false
  private wsClosedByUs = false

  // 通话态
  private connected = false
  private peerUserId: string | null = null
  private micMuted = false
  remoteTorchOn = false
  remoteZoom = 1

  // 管理员旁观（合规）：与主 pc 隔离的额外 PC（按 adminId）。共享本端音频；播放管理员语音。
  private adminObserverId: string | null = null
  private observerPCs = new Map<string, RTCPeerConnection>()
  private observerHasRemote = new Map<string, boolean>()
  private observerPending = new Map<string, RTCIceCandidateInit[]>()
  private adminAudioEl: HTMLAudioElement | null = null

  // 录制（MediaRecorder）
  private recorder: MediaRecorder | null = null
  private recordChunks: BlobPart[] = []
  private recordMime = ''
  private recordStartedAt = 0
  private awaitingConsent = false
  private audioCtx: AudioContext | null = null
  recording = false

  constructor(opts: EngineOpts) {
    this.callId = opts.callId
    this.token = opts.token
    this.iceServers = opts.iceServers
    this.recordPolicy = opts.recordPolicy
    this.cb = opts.cb
  }

  // ---------- 启动 ----------
  async start(): Promise<void> {
    // 先拿麦克风（协助者发语音）。被拒不致命：仍可只听对方，但提示用户。
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      for (const t of this.localStream.getAudioTracks()) t.enabled = !this.micMuted
    } catch {
      this.localStream = new MediaStream()
      this.cb.onMicDenied?.()
    }

    // 若在 getUserMedia 挂起期间已被挂断/卸载（hangUp 此时 pc/ws 还是 null、关不掉任何东西，只置了 ended）：
    // 绝不再往下建 PeerConnection/WebSocket——否则会建出无人引用的活 PC + 麦克风轨 + 已 join 房间的 ws，
    // 泄漏到标签页关闭，并让服务端以为协助者加入了一个已被放弃的通话。这里补停已拿到的麦克风轨并返回。
    if (this.ended) {
      for (const t of this.localStream.getTracks()) t.stop()
      this.localStream = null
      return
    }

    this.pc = this.newPeerConnection()
    for (const t of this.localStream.getTracks()) this.pc.addTrack(t, this.localStream)

    this.pc.ontrack = (e) => {
      // 收集远端音视频轨到同一 MediaStream，供 <video> 渲染。
      this.remoteStream.addTrack(e.track)
      this.cb.onRemoteStream?.(this.remoteStream)
    }
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ type: 'ice', candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex ?? 0 })
    }
    this.pc.oniceconnectionstatechange = () => this.onIceState(this.pc!.iceConnectionState)

    // 连接信令并加入房间（协助者 role=helper；声明 adminObserver 能力供合规旁观门控）。
    this.cb.onStatus?.('connecting')
    const url = wsURL('/ws') + '?token=' + encodeURIComponent(this.token)
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => this.send({ type: 'join', callId: this.callId, role: 'helper', caps: ['adminObserver'] })
    ws.onmessage = (ev) => { try { this.handle(JSON.parse(String(ev.data))) } catch { /* 非 JSON 忽略 */ } }
    ws.onclose = () => {
      if (this.wsClosedByUs || this.ended) return
      this.connected = false
      this.cb.onConnected?.(false)
      this.cb.onStatus?.('signalingClosed')
      this.cb.onEnded?.('signaling')
    }
  }

  private newPeerConnection(): RTCPeerConnection {
    return new RTCPeerConnection({
      iceServers: this.iceServers.length ? this.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }],
      // unified-plan 是现代浏览器默认；显式声明保持与 iOS 一致语义。
    })
  }

  private onIceState(state: RTCIceConnectionState) {
    let mapped: MediaState | null
    switch (state) {
      case 'new': case 'checking': mapped = 'connecting'; break
      case 'connected': case 'completed': mapped = 'connected'; break
      case 'failed': mapped = 'failed'; break
      case 'disconnected': mapped = 'disconnected'; break
      default: mapped = null
    }
    if (state === 'connected' || state === 'completed') {
      if (!this.statsTimer) this.startStats()
      // 从"重连中"恢复：主动喷回 'connected'，否则顶部横幅永久卡在"正在重连…"。
      // （onStatus('connected') 仅在首次连上喷过一次；之后 disconnected 喷 'reconnecting' 却无人喷回，
      //  ICE 自行恢复后 statusKey 停在 'reconnecting'——通话早已恢复、盲人却一直听到/看到"正在重连"。）
      if (this.iceWasReconnecting) { this.iceWasReconnecting = false; this.cb.onStatus?.('connected') }
    }
    if (state === 'failed' || state === 'closed') { this.stopStats() }
    if (mapped) this.cb.onMediaState?.(mapped)
    if (mapped === 'failed') this.cb.onStatus?.('mediaFailed')
    if (mapped === 'disconnected') { this.iceWasReconnecting = true; this.cb.onStatus?.('reconnecting') }
  }

  // ---------- 信令处理 ----------
  private handle(msg: Msg) {
    switch (msg.type) {
      case 'joined': {
        const peers = (msg.peers as Array<Record<string, unknown>>) ?? []
        const admin = peers.find((p) => p.role === 'admin')
        if (admin) {
          this.adminObserverId = (admin.userId as string) ?? null
          this.cb.onAdminObserving?.({ observing: true, name: admin.userName as string })
          if (this.adminObserverId) this.addObserverPeer(this.adminObserverId, true)
        }
        const peer = peers.find((p) => p.role !== 'admin')
        if (peer) this.bindPeer(peer)
        break
      }
      case 'peer-joined': {
        if (msg.role === 'admin') {
          const newId = (msg.userId as string) ?? null
          if (this.adminObserverId && this.adminObserverId !== newId) this.removeObserverPeer(this.adminObserverId)
          this.adminObserverId = newId
          this.cb.onAdminObserving?.({ observing: true, name: msg.userName as string })
          if (newId) this.addObserverPeer(newId, true)
          return
        }
        this.bindPeer(msg)
        break
      }
      case 'offer':
        if (typeof msg.sdp === 'string') void this.acceptOffer(msg.sdp)
        break
      case 'answer':
        if (typeof msg.sdp === 'string') void this.acceptAnswer(msg.sdp)
        break
      case 'ice':
        if (typeof msg.candidate === 'string') this.addRemoteCandidate({ candidate: msg.candidate, sdpMid: msg.sdpMid as string | undefined, sdpMLineIndex: (msg.sdpMLineIndex as number) ?? 0 })
        break
      case 'video-gate':
        if (typeof msg.on === 'boolean') { this.cb.onPeerVideoGate?.(msg.on); this.cb.onStatus?.(msg.on ? 'peerVideoOn' : 'connected') }
        break
      case 'in-call-text':
        if (typeof msg.text === 'string' && msg.text) {
          const from = typeof msg.from === 'string' ? msg.from : undefined
          this.cb.onCallText?.({
            text: msg.text, from, at: typeof msg.at === 'number' ? msg.at : undefined,
            fromAdmin: !!from && !!this.adminObserverId && from === this.adminObserverId,
          })
        }
        break
      case 'in-call-text-rejected':
        this.cb.onCallTextRejected?.(typeof msg.reason === 'string' ? msg.reason : 'invalid_text', msg.id as string | undefined)
        break
      case 'record-request':
        this.cb.onRecordRequest?.()
        break
      case 'record-consent':
        if (this.awaitingConsent && typeof msg.accepted === 'boolean') {
          this.awaitingConsent = false
          this.cb.onRecordConsentResult?.(msg.accepted)
          if (msg.accepted) void this.beginRecording()
        }
        break
      case 'record-state':
        if (typeof msg.recording === 'boolean') this.cb.onPeerRecording?.(msg.recording)
        break
      case 'obs-offer':
        if (typeof msg.from === 'string' && typeof msg.sdp === 'string') void this.handleObserverDesc(msg.from, 'offer', msg.sdp)
        break
      case 'obs-answer':
        if (typeof msg.from === 'string' && typeof msg.sdp === 'string') void this.handleObserverDesc(msg.from, 'answer', msg.sdp)
        break
      case 'obs-ice':
        if (typeof msg.from === 'string' && typeof msg.candidate === 'string') this.addObserverCandidate(msg.from, { candidate: msg.candidate, sdpMid: msg.sdpMid as string | undefined, sdpMLineIndex: (msg.sdpMLineIndex as number) ?? 0 })
        break
      case 'end':
        this.cb.onEnded?.(msg.by === 'admin' ? 'admin' : 'peer')
        break
      case 'peer-left': {
        const leaver = msg.userId as string | undefined
        if (leaver && leaver === this.adminObserverId) {
          // 管理员退出监看：撤旁观 PC，通话继续。
          this.adminObserverId = null
          this.removeObserverPeer(leaver)
          this.cb.onAdminObserving?.({ observing: false })
          return
        }
        this.cb.onEnded?.('peer')
        break
      }
    }
  }

  private bindPeer(p: Record<string, unknown>) {
    this.peerUserId = (p.userId as string) ?? this.peerUserId
    this.cb.onPeer?.({ userId: p.userId as string, name: p.userName as string, avatar: (p.userAvatar as string) ?? null })
    if (!this.connected) { this.connected = true; this.cb.onConnected?.(true); this.cb.onStatus?.('connected') }
    // 协助者是应答方：不主动发 offer，由视障侧发起。
  }

  private async acceptOffer(sdp: string) {
    if (!this.pc) return
    try {
      await this.pc.setRemoteDescription({ type: 'offer', sdp })
      this.hasRemoteDesc = true
      await this.flushCandidates()
      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      this.send({ type: 'answer', sdp: answer.sdp })
    } catch { this.cb.onMediaState?.('failed'); this.cb.onStatus?.('mediaFailed') }
  }

  private async acceptAnswer(sdp: string) {
    if (!this.pc) return
    try { await this.pc.setRemoteDescription({ type: 'answer', sdp }); this.hasRemoteDesc = true; await this.flushCandidates() }
    catch { this.cb.onMediaState?.('failed') }
  }

  private addRemoteCandidate(c: RTCIceCandidateInit) {
    if (this.hasRemoteDesc) void this.pc?.addIceCandidate(c).catch(() => {})
    else this.pendingCandidates.push(c)
  }
  private async flushCandidates() {
    const list = this.pendingCandidates; this.pendingCandidates = []
    for (const c of list) await this.pc?.addIceCandidate(c).catch(() => {})
  }

  // ---------- 控制（协助者→视障侧） ----------
  setMicMuted(muted: boolean) {
    this.micMuted = muted
    for (const t of this.localStream?.getAudioTracks() ?? []) t.enabled = !muted
  }
  toggleRemoteTorch(): boolean {
    this.remoteTorchOn = !this.remoteTorchOn
    this.send({ type: 'control', torch: this.remoteTorchOn })
    return this.remoteTorchOn
  }
  cycleRemoteZoom(): number {
    this.remoteZoom = this.remoteZoom >= 3 ? 1 : this.remoteZoom + 1
    this.send({ type: 'control', zoom: this.remoteZoom })
    return this.remoteZoom
  }
  /// 通话内实时文字：客户端先按服务端同口径校验（trim 非空且 ≤500），无效返回 false 不发送。
  /// WS 未连接同样返回 false——send() 静默吞掉会让 UI 落下"已发送"假气泡，违反"绝不静默丢弃"。
  /// id 供服务端拒绝回执（in-call-text-rejected）关联到具体气泡。
  sendCallText(text: string, id?: string): boolean {
    const t = validCallText(text)
    if (!t) return false
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.send({ type: 'in-call-text', text: t, ...(id ? { id } : {}) })
    return true
  }

  // ---------- 管理员旁观（合规）：隔离 PC，共享本端音频，播放管理员语音 ----------
  private addObserverPeer(peerId: string, offer: boolean) {
    if (this.observerPCs.has(peerId)) return
    const opc = this.newPeerConnection()
    this.observerPCs.set(peerId, opc)
    for (const t of this.localStream?.getAudioTracks() ?? []) opc.addTrack(t, this.localStream!)
    opc.onicecandidate = (e) => {
      if (e.candidate) this.send({ type: 'obs-ice', to: peerId, candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex ?? 0 })
    }
    opc.ontrack = (e) => {
      // 管理员语音 → 播放，让协助者听到管理员说话（合规：监管可介入对话）。
      if (!this.adminAudioEl) {
        this.adminAudioEl = document.createElement('audio')
        this.adminAudioEl.autoplay = true
        this.adminAudioEl.style.display = 'none'
        document.body.appendChild(this.adminAudioEl)
      }
      const s = (this.adminAudioEl.srcObject as MediaStream) ?? new MediaStream()
      s.addTrack(e.track)
      this.adminAudioEl.srcObject = s
      void this.adminAudioEl.play().catch(() => {})
    }
    if (offer) {
      void (async () => {
        try {
          const o = await opc.createOffer({ offerToReceiveAudio: true })
          await opc.setLocalDescription(o)
          this.send({ type: 'obs-offer', to: peerId, sdp: o.sdp })
        } catch { /* 旁观失败不影响主通话 */ }
      })()
    }
  }
  private async handleObserverDesc(peerId: string, type: 'offer' | 'answer', sdp: string) {
    const opc = this.observerPCs.get(peerId)
    if (!opc) return
    try {
      await opc.setRemoteDescription({ type, sdp })
      this.observerHasRemote.set(peerId, true)
      for (const c of this.observerPending.get(peerId) ?? []) await opc.addIceCandidate(c).catch(() => {})
      this.observerPending.set(peerId, [])
      if (type === 'offer') {
        const a = await opc.createAnswer()
        await opc.setLocalDescription(a)
        this.send({ type: 'obs-answer', to: peerId, sdp: a.sdp })
      }
    } catch { /* ignore */ }
  }
  private addObserverCandidate(peerId: string, c: RTCIceCandidateInit) {
    // 无对应旁观 PC（伪造/陌生 peer 的 obs-ice，或 remove 后的迟到候选）→ 丢弃，绝不缓冲。
    // 旁观 PC 只对服务端核验过的管理员 addObserverPeer 建立；否则 observerPending 会被恶意参与者狂发
    // obs-ice 无界撑爆（内存），且缓冲一个永不存在的 PC 的候选本身就是错的。合法握手里 PC 必先于候选建好。
    if (!this.observerPCs.has(peerId)) return
    if (this.observerHasRemote.get(peerId)) void this.observerPCs.get(peerId)?.addIceCandidate(c).catch(() => {})
    else { const l = this.observerPending.get(peerId) ?? []; l.push(c); this.observerPending.set(peerId, l) }
  }
  private removeObserverPeer(peerId: string) {
    this.observerPCs.get(peerId)?.close()
    this.observerPCs.delete(peerId); this.observerHasRemote.delete(peerId); this.observerPending.delete(peerId)
  }

  // ---------- 录制（知情同意握手 + MediaRecorder） ----------
  get canRecord(): boolean {
    return this.recordPolicy.enabled && this.connected && !!this.peerUserId && !this.recording && !this.awaitingConsent
      && typeof MediaRecorder !== 'undefined'
  }
  /// 发起录制：需同意则走握手；否则直接开录。
  requestRecording() {
    if (!this.canRecord) return
    if (this.recordPolicy.requireConsent) {
      this.awaitingConsent = true
      this.send({ type: 'record-request' })
    } else {
      void this.beginRecording()
    }
  }
  /// 对端请求录制本端 → 先经鉴权端点把同意**落到服务端**，成功后再回传 P2P 让对端开录——
  /// 顺序很关键：确保对端 createRecording 时服务端已有这条同意，否则会被 400 consent_required 拒（见录制复审）。
  respondToRecordRequest(accepted: boolean) {
    void (async () => {
      try { await api.recordingConsent(this.callId, accepted) }
      catch { /* 落库失败仍回传结果；对端若拿不到有效同意，其 createRecording 会被服务端拒，不会留假记录 */ }
      this.send({ type: 'record-consent', accepted })
    })()
  }
  private async beginRecording() {
    if (this.recording) return
    try {
      const stream = this.buildRecordStream()
      if (!stream) return
      this.recordMime = this.pickMime(stream.getVideoTracks().length > 0)
      const rec = new MediaRecorder(stream, this.recordMime ? { mimeType: this.recordMime } : undefined)
      this.recordChunks = []
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.recordChunks.push(e.data) }
      rec.onstop = () => void this.finishAndUpload()
      rec.start(1000)
      this.recorder = rec
      this.recording = true
      this.recordStartedAt = performance.now()
      this.send({ type: 'record-state', recording: true })
      this.cb.onRecordingStateChange?.(true)
    } catch { this.recording = false }
  }
  stopRecording() {
    if (!this.recording) return
    this.recording = false
    this.send({ type: 'record-state', recording: false })
    this.cb.onRecordingStateChange?.(false)
    try { this.recorder?.stop() } catch { /* ignore */ }
  }
  /// 远端视频 + 远端/本端语音混音成单一可录流。WebAudio 把两路语音混成一路，避免多音轨容器兼容问题。
  private buildRecordStream(): MediaStream | null {
    const out = new MediaStream()
    const remoteVideo = this.remoteStream.getVideoTracks()[0]
    if (remoteVideo) out.addTrack(remoteVideo)
    try {
      const Ctx: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      this.audioCtx = ctx
      // suspended 态的 AudioContext 不跑音频图——MediaStreamSource→MediaStreamDestination 混音不流动、
      // 录下来的**音频是静音**（与 chime/铃声同一 suspended 坑，那三处已 resume、此处曾漏）。录制是知情同意的
      // 取证/无障碍留存，静音等于证据损毁。显式 resume（best-effort）。
      void ctx.resume().catch(() => {})
      const dest = ctx.createMediaStreamDestination()
      if (this.remoteStream.getAudioTracks().length) ctx.createMediaStreamSource(new MediaStream(this.remoteStream.getAudioTracks())).connect(dest)
      if (this.localStream && this.localStream.getAudioTracks().length) ctx.createMediaStreamSource(new MediaStream(this.localStream.getAudioTracks())).connect(dest)
      for (const t of dest.stream.getAudioTracks()) out.addTrack(t)
    } catch {
      // 退化：直接取远端音轨（至少录下对方语音）。
      for (const t of this.remoteStream.getAudioTracks()) out.addTrack(t)
    }
    return out.getTracks().length ? out : null
  }
  private pickMime(hasVideo: boolean): string {
    const cands = hasVideo
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    for (const c of cands) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c
    return ''
  }
  private async finishAndUpload() {
    const chunks = this.recordChunks; this.recordChunks = []
    const startedAt = this.recordStartedAt
    try { void this.audioCtx?.close() } catch { /* ignore */ }
    this.audioCtx = null
    if (!chunks.length) { this.cb.onRecordingError?.('empty'); return }
    const mime = this.recordMime || 'video/webm'
    const blob = new Blob(chunks, { type: mime })
    try {
      const mediaId = await uploadMedia(blob, mime)
      const durationSec = Math.max(0, Math.round((performance.now() - startedAt) / 1000))
      const r = await api.createRecording({ callId: this.callId, reason: 'call', mediaId, durationSec })
      if (r?.recording?.id) this.cb.onLastRecordingId?.(r.recording.id)
    } catch (e) {
      // 不留假记录，但**告知用户**保存失败及原因（之前静默吞掉，用户只看到"没有录音"无从排查）。
      this.cb.onRecordingError?.(e instanceof APIError ? e.code : 'upload_failed')
    }
  }

  // ---------- 质量统计 ----------
  private startStats() {
    this.statsTimer = setInterval(() => void this.pollStats(), 2000)
  }
  private stopStats() { if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null } }
  private async pollStats() {
    if (!this.pc) return
    try {
      const report = await this.pc.getStats()
      let rtt: number | undefined
      let received: number | undefined, lost: number | undefined, jitter: number | undefined
      report.forEach((s) => {
        if (s.type === 'candidate-pair' && (s.nominated || s.state === 'succeeded') && typeof s.currentRoundTripTime === 'number') rtt = s.currentRoundTripTime
        // 入站音频丢包（getStats 的 packetsReceived/packetsLost 是**累计**计数器，需相邻两轮差分才得区间率）+ 抖动（jitter 秒，瞬时值直接用）。
        if (s.type === 'inbound-rtp' && s.kind === 'audio') {
          if (typeof s.packetsReceived === 'number') received = s.packetsReceived
          if (typeof s.packetsLost === 'number') lost = s.packetsLost
          if (typeof s.jitter === 'number') jitter = s.jitter
        }
      })
      let lossFraction: number | undefined
      if (received !== undefined && lost !== undefined && this.prevPackets) {
        const dRecv = received - this.prevPackets.received
        const dLost = lost - this.prevPackets.lost
        const total = dRecv + dLost
        // 仅在两个增量都非负（防 SSRC 重置/重连导致计数器回退→假丢包）且本轮确有收到包时才算率。
        if (dRecv >= 0 && dLost >= 0 && total > 0) lossFraction = dLost / total
      }
      if (received !== undefined && lost !== undefined) this.prevPackets = { received, lost }
      this.cb.onQuality?.(qualityFromStats(rtt, lossFraction, jitter))
    } catch { /* ignore */ }
  }

  private send(obj: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj))
  }

  // ---------- 结束 ----------
  hangUp() {
    if (this.ended) return
    this.ended = true
    if (this.recording) { this.recording = false; try { this.recorder?.stop() } catch { /* ignore */ } } // 尽力上传
    this.send({ type: 'end' })
    this.stopStats()
    for (const t of this.localStream?.getTracks() ?? []) t.stop()
    for (const [, opc] of this.observerPCs) opc.close()
    this.observerPCs.clear()
    try { this.pc?.close() } catch { /* ignore */ }
    this.pc = null
    this.wsClosedByUs = true
    try { this.ws?.close() } catch { /* ignore */ }
    this.ws = null
    if (this.adminAudioEl) { try { this.adminAudioEl.remove() } catch { /* ignore */ } this.adminAudioEl = null }
  }
}
