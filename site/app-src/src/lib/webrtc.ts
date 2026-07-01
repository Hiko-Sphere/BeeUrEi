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
    if (state === 'connected' || state === 'completed') { if (!this.statsTimer) this.startStats() }
    if (state === 'failed' || state === 'closed') { this.stopStats() }
    if (mapped) this.cb.onMediaState?.(mapped)
    if (mapped === 'failed') this.cb.onStatus?.('mediaFailed')
    if (mapped === 'disconnected') this.cb.onStatus?.('reconnecting')
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
      report.forEach((s) => {
        if (s.type === 'candidate-pair' && (s.nominated || s.state === 'succeeded') && typeof s.currentRoundTripTime === 'number') rtt = s.currentRoundTripTime
      })
      this.cb.onQuality?.(qualityFromRtt(rtt))
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
