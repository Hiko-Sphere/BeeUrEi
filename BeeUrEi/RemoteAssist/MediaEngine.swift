import Foundation

/// 真实媒体（P2P）连接状态——区别于"信令是否加入房间"。
enum MediaConnState: Equatable {
    case connecting   // ICE 协商中
    case connected    // 媒体已连通（可传音视频）
    case failed       // 媒体连接失败（多为 NAT 穿透失败：跨网络需 TURN，或同 WiFi 也被网络隔离）
    case disconnected // 暂时中断（可能恢复）
}

/// 通话连接质量（用 WebRTC 实测往返时延表达"信号强弱"——iOS 不开放原始信号格数）。
enum CallQuality: Equatable {
    case unknown, weak, fair, good
    /// 本地化的"信号强弱"文案见 `CallStrings.signalLabel(_:_:)`（UI 层，随语言）。
    /// 显示几格（0–3）。
    var bars: Int { switch self { case .good: return 3; case .fair: return 2; case .weak: return 1; case .unknown: return 0 } }
}

/// 媒体引擎抽象（WebRTC）。把"真实音视频"与"信令/UI"解耦。
///
/// 视频隐私模型（见 BACKEND_PLAN §5）：
/// - 协助者(asCaller=false)：不发视频、收对方视频 + 双向语音。
/// - 视障侧(asCaller=true)：默认只发音频；`setLocalVideoSending(true)` 时才发视频轨。
protocol MediaEngine: AnyObject {
    /// 本端生成的 SDP（type 为 "offer"/"answer"），交给信令发送。
    var onLocalDescription: ((_ type: String, _ sdp: String) -> Void)? { get set }
    /// 本端生成的 ICE candidate，交给信令发送。
    var onLocalCandidate: ((_ candidate: String, _ sdpMid: String?, _ sdpMLineIndex: Int32) -> Void)? { get set }
    /// 真实 ICE/媒体连接状态变化（主线程回调）——用于把"信令已连接但媒体没通"暴露出来，便于定位无画面。
    var onMediaStateChange: ((_ state: MediaConnState) -> Void)? { get set }
    /// 协助者侧：收到远端视频轨（主线程回调）。
    var onRemoteVideoTrack: (() -> Void)? { get set }
    /// 通话质量定期上报（主线程回调）——"信号强弱"。
    var onCallQuality: ((_ quality: CallQuality) -> Void)? { get set }

    func setIceServers(_ servers: [IceServerInfo])
    func start(asCaller: Bool)
    func createOffer()
    func handleRemoteDescription(type: String, sdp: String)
    func handleRemoteCandidate(candidate: String, sdpMid: String?, sdpMLineIndex: Int32)
    func setLocalVideoSending(_ sending: Bool)
    func setCameraPosition(front: Bool) // 切换前/后摄像头（前置=显示面部）
    func setMicMuted(_ muted: Bool) // 静音：禁用/启用本端音频轨
    func setTorch(_ on: Bool)       // 手电筒（协助者远程开/关，暗光看不清时）
    func setZoom(_ factor: Double)  // 变焦（协助者远程放大看细节）
    func stop()

    // MARK: 管理员旁观（合规监管，会通知双方）——与 1:1 主通道**隔离**的额外 PC，共享同一本地音视频轨。
    /// 旁观握手 SDP（带目标 peerId）→ 经信令以 obs-offer/obs-answer 定向发送。
    var onObserverLocalDescription: ((_ peerId: String, _ type: String, _ sdp: String) -> Void)? { get set }
    /// 旁观握手 ICE（带目标 peerId）→ 经信令以 obs-ice 定向发送。
    var onObserverLocalCandidate: ((_ peerId: String, _ candidate: String, _ sdpMid: String?, _ sdpMLineIndex: Int32) -> Void)? { get set }
    /// 收到某旁观对端的远端视频轨（管理员侧渲染参与者画面用）。
    var onObserverRemoteVideoTrack: ((_ peerId: String) -> Void)? { get set }
    /// 新增一个旁观对端。offer=true 时本端主动发 offer（"既有参与者向新加入的管理员发 offer"）。
    func addObserverPeer(_ peerId: String, offer: Bool)
    func handleObserverDescription(from peerId: String, type: String, sdp: String)
    func handleObserverCandidate(from peerId: String, candidate: String, sdpMid: String?, sdpMLineIndex: Int32)
    func removeObserverPeer(_ peerId: String)
    // 注：setObserverRenderer(_:for:) 用 RTCVideoRenderer（WebRTC 类型），仅在具体类 WebRTCMediaEngine 上提供（同 setRemoteRenderer）。
}

/// 无 WebRTC 包时（如克隆仓库未放入被 gitignore 的 91MB `Frameworks/WebRTC.xcframework`）的兜底。
/// **不伪装连接**：start 即如实上报媒体失败，让 UI 提示"媒体连接失败"，而不是假装通话已接通。
/// 真机发行版会带上 xcframework → 走下方 `WebRTCMediaEngine` 真实媒体，本类不参与编译。
final class StubMediaEngine: MediaEngine {
    var onLocalDescription: ((String, String) -> Void)?
    var onLocalCandidate: ((String, String?, Int32) -> Void)?
    var onMediaStateChange: ((MediaConnState) -> Void)?
    var onRemoteVideoTrack: (() -> Void)?
    var onCallQuality: ((CallQuality) -> Void)?
    func setIceServers(_ servers: [IceServerInfo]) {}
    func start(asCaller: Bool) {
        DispatchQueue.main.async { [weak self] in self?.onMediaStateChange?(.failed) }
    }
    func createOffer() {}
    func handleRemoteDescription(type: String, sdp: String) {}
    func handleRemoteCandidate(candidate: String, sdpMid: String?, sdpMLineIndex: Int32) {}
    func setLocalVideoSending(_ sending: Bool) {}
    func setCameraPosition(front: Bool) {}
    func setMicMuted(_ muted: Bool) {}
    func setTorch(_ on: Bool) {}
    func setZoom(_ factor: Double) {}
    func stop() {}
    var onObserverLocalDescription: ((String, String, String) -> Void)?
    var onObserverLocalCandidate: ((String, String, String?, Int32) -> Void)?
    var onObserverRemoteVideoTrack: ((String) -> Void)?
    func addObserverPeer(_ peerId: String, offer: Bool) {}
    func handleObserverDescription(from peerId: String, type: String, sdp: String) {}
    func handleObserverCandidate(from peerId: String, candidate: String, sdpMid: String?, sdpMLineIndex: Int32) {}
    func removeObserverPeer(_ peerId: String) {}
}

/// 默认引擎工厂：装了 WebRTC 包用真实引擎，否则用 stub。
enum MediaEngineFactory {
    static func make() -> MediaEngine {
        #if canImport(WebRTC)
        return WebRTCMediaEngine()
        #else
        return StubMediaEngine()
        #endif
    }
}

// MARK: - 真实 WebRTC 实现（需在 Xcode 添加 stasel/WebRTC 包；双真机验证）

#if canImport(WebRTC)
import WebRTC
import CoreMedia
import AVFoundation

/// 自托管 WebRTC：P2P 1:1。STUN 用公共，TURN 待接自托管 coturn。
final class WebRTCMediaEngine: NSObject, MediaEngine, RTCPeerConnectionDelegate {
    var onLocalDescription: ((String, String) -> Void)?
    var onLocalCandidate: ((String, String?, Int32) -> Void)?
    var onMediaStateChange: ((MediaConnState) -> Void)?
    var onRemoteVideoTrack: (() -> Void)?
    var onCallQuality: ((CallQuality) -> Void)?
    var onObserverLocalDescription: ((String, String, String) -> Void)?
    var onObserverLocalCandidate: ((String, String, String?, Int32) -> Void)?
    var onObserverRemoteVideoTrack: ((String) -> Void)?
    private var statsTimer: Timer?

    // 旁观（管理员）专用：与主 pc 隔离的额外 PC（按 peerId），共享同一本地音视频轨。主 1:1 路径完全不受影响。
    private var observerPCs: [String: RTCPeerConnection] = [:]
    private var observerDelegates: [String: ObserverPCDelegate] = [:] // RTCPeerConnection 仅弱引用 delegate，须自留强引用
    private var observerHasRemote: [String: Bool] = [:]
    private var observerPending: [String: [RTCIceCandidate]] = [:]
    private var observerRemoteTracks: [String: RTCVideoTrack] = [:]
    private var observerRenderers: [String: RTCVideoRenderer] = [:]

    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        return RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(),
                                        decoderFactory: RTCDefaultVideoDecoderFactory())
    }()

    private var pc: RTCPeerConnection?
    private var localVideoTrack: RTCVideoTrack?
    private var localAudioTrack: RTCAudioTrack?
    private var micMuted = false
    private var videoCapturer: RTCCameraVideoCapturer?
    private var videoSender: RTCRtpSender?
    private var cameraFront = false // false=后置(看前方场景) true=前置(看面部)
    private var activeDevice: AVCaptureDevice? // 当前采集设备（手电筒/变焦远程控制用）
    private var capturing = false // 仅在用户主动发画面时才开相机（最小权限/默认隐私，见审查 #2）
    private(set) var remoteVideoTrack: RTCVideoTrack?
    private weak var remoteRenderer: RTCVideoRenderer?
    private var asCaller = false
    private var iceConfig: [IceServerInfo] = []
    // 远端候选缓存：WebRTC 要求先成功 setRemoteDescription 才能 add 远端候选，否则被静默丢弃 → 连接建立失败/退化。
    // 早到的候选先入队，待 setRemoteDescription 成功后统一 flush。两者只在主线程访问（信令消息经 @MainActor 投递，
    // flush 也 hop 回主线程），避免与 add 竞争（见审查 #1/#6）。
    private var pendingCandidates: [RTCIceCandidate] = []
    private var hasRemoteDescription = false

    func setIceServers(_ servers: [IceServerInfo]) { iceConfig = servers }

    /// 把音频会话配成 WebRTC 通话所需的 .playAndRecord（双向语音）。
    /// 必须经 RTCAudioSession 配置，让 WebRTC 与会话状态同步——直接改 AVAudioSession 会与 WebRTC 内部状态冲突致无声。
    private func configureAudioSession() {
        let session = RTCAudioSession.sharedInstance()
        let config = RTCAudioSessionConfiguration.webRTC()
        config.category = AVAudioSession.Category.playAndRecord.rawValue
        config.mode = AVAudioSession.Mode.voiceChat.rawValue
        config.categoryOptions = [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker] // 默认走扬声器，盲人免持
        session.lockForConfiguration()
        try? session.setConfiguration(config, active: true)
        session.unlockForConfiguration()
    }

    func start(asCaller: Bool) {
        self.asCaller = asCaller
        configureAudioSession() // 关键：切到 .playAndRecord，否则 App 启动设的 .playback 只放不录→听不见/采不到声（见音频深审）
        let config = RTCConfiguration()
        config.iceServers = iceConfig.isEmpty
            ? [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
            : iceConfig.map { RTCIceServer(urlStrings: $0.urls, username: $0.username ?? "", credential: $0.credential ?? "") }
        config.sdpSemantics = .unifiedPlan
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        pc = Self.factory.peerConnection(with: config, constraints: constraints, delegate: self)

        // 双方都发音频。
        let audioSource = Self.factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
        let audioTrack = Self.factory.audioTrack(with: audioSource, trackId: "audio0")
        pc?.add(audioTrack, streamIds: ["stream0"])
        localAudioTrack = audioTrack
        localAudioTrack?.isEnabled = !micMuted // 维持当前静音态（重连等场景）

        if asCaller {
            // 视障侧：加摄像头视频轨，但默认 disabled（不输出画面）。
            let videoSource = Self.factory.videoSource()
            let capturer = RTCCameraVideoCapturer(delegate: videoSource)
            let videoTrack = Self.factory.videoTrack(with: videoSource, trackId: "video0")
            videoTrack.isEnabled = false
            videoSender = pc?.add(videoTrack, streamIds: ["stream0"]) // 留存 sender 以便设码率/降级策略
            localVideoTrack = videoTrack
            videoCapturer = capturer
            // 不在此处开相机：仅在 setLocalVideoSending(true) 时才启动采集，确保相机只在用户主动
            // 发画面期间运转、隐私指示灯与"画面未发送"一致（见审查 #2）。
        }
    }

    func createOffer() {
        let constraints = RTCMediaConstraints(
            mandatoryConstraints: ["OfferToReceiveAudio": "true", "OfferToReceiveVideo": "true"],
            optionalConstraints: nil)
        pc?.offer(for: constraints) { [weak self] sdp, error in
            guard let self else { return }
            // SDP 创建失败别静默——否则盲人主叫会永远停在"正在连接…"。上报 .failed 让 UI 提示重拨（见 P2 审计）。
            guard let sdp, error == nil else {
                DispatchQueue.main.async { self.onMediaStateChange?(.failed) }
                return
            }
            self.pc?.setLocalDescription(sdp) { err in
                if err != nil { DispatchQueue.main.async { self.onMediaStateChange?(.failed) } }
            }
            self.onLocalDescription?("offer", sdp.sdp)
        }
    }

    func handleRemoteDescription(type: String, sdp: String) {
        let rtcType: RTCSdpType = (type == "offer") ? .offer : .answer
        pc?.setRemoteDescription(RTCSessionDescription(type: rtcType, sdp: sdp)) { [weak self] error in
            guard let self else { return }
            guard error == nil else {
                // setRemoteDescription 失败 = 协商无法继续，别静默——上报 .failed 让 UI 提示重拨（见 P2 审计）。
                DispatchQueue.main.async { self.onMediaStateChange?(.failed) }
                return
            }
            // remoteDescription 已就位：在主线程 flush 之前缓存的早到候选（见审查 #1）。
            DispatchQueue.main.async {
                self.hasRemoteDescription = true
                for c in self.pendingCandidates { self.pc?.add(c) { _ in } }
                self.pendingCandidates.removeAll()
            }
            // 收到 offer 且设置成功 → 本端回 answer。
            guard rtcType == .offer else { return }
            let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
            self.pc?.answer(for: constraints) { sdp, answerError in
                guard let sdp, answerError == nil else {
                    DispatchQueue.main.async { self.onMediaStateChange?(.failed) }
                    return
                }
                self.pc?.setLocalDescription(sdp) { _ in }
                self.onLocalDescription?("answer", sdp.sdp)
            }
        }
    }

    func handleRemoteCandidate(candidate: String, sdpMid: String?, sdpMLineIndex: Int32) {
        // 调用方在主线程（信令经 @MainActor 投递）。remoteDescription 未就位前先缓存，避免被 WebRTC 丢弃（见审查 #1）。
        let c = RTCIceCandidate(sdp: candidate, sdpMLineIndex: sdpMLineIndex, sdpMid: sdpMid)
        if hasRemoteDescription {
            pc?.add(c) { _ in }
        } else {
            pendingCandidates.append(c)
        }
    }

    func setLocalVideoSending(_ sending: Bool) {
        localVideoTrack?.isEnabled = sending
        // 按需开/关相机硬件：发画面时才采集，停发即停采集（见审查 #2）。
        if sending {
            if !capturing, let capturer = videoCapturer { startCapture(capturer); capturing = true }
            applyVideoQuality() // 此刻多已协商完成，encodings 已就绪，设高画质上限+拥塞降级
        } else if capturing {
            videoCapturer?.stopCapture()
            capturing = false
        }
    }

    func setCameraPosition(front: Bool) {
        guard front != cameraFront else { return }
        cameraFront = front
        // 若正在采集，切到新摄像头（停旧采集→以新设备重启）。
        if capturing, let capturer = videoCapturer {
            capturer.stopCapture { [weak self] in
                guard let self else { return }
                DispatchQueue.main.async { self.startCapture(capturer) }
            }
        }
    }

    /// 设较高画质上限 + 拥塞自动降级（卡顿时由 WebRTC 自动降分辨率/帧率，不卡时保持高清）。
    private func applyVideoQuality() {
        guard let sender = videoSender else { return }
        let params = sender.parameters
        for enc in params.encodings {
            enc.maxBitrateBps = NSNumber(value: 2_500_000) // 上限 ~2.5Mbps（720p 流畅高清）
            enc.maxFramerate = NSNumber(value: 30)
        }
        // balanced：拥塞时分辨率与帧率一起酌情下调，恢复后回升（“卡顿才降画质”）。
        params.degradationPreference = NSNumber(value: RTCDegradationPreference.balanced.rawValue)
        sender.parameters = params
    }

    func setMicMuted(_ muted: Bool) {
        micMuted = muted
        localAudioTrack?.isEnabled = !muted
    }

    /// 手电筒（协助者远程开/关）：仅后置摄像头有手电；采集停止后系统自动关闭。
    func setTorch(_ on: Bool) {
        guard let device = activeDevice, device.hasTorch else { return }
        do {
            try device.lockForConfiguration()
            device.torchMode = on ? .on : .off
            device.unlockForConfiguration()
        } catch { /* 设备占用等：忽略，保持原状 */ }
    }

    /// 变焦（协助者远程放大看细节）。限制在设备支持范围内。
    func setZoom(_ factor: Double) {
        guard let device = activeDevice else { return }
        do {
            try device.lockForConfiguration()
            device.videoZoomFactor = min(max(1, factor), min(device.activeFormat.videoMaxZoomFactor, 5))
            device.unlockForConfiguration()
        } catch { /* 忽略 */ }
    }

    func stop() {
        statsTimer?.invalidate(); statsTimer = nil
        if capturing { videoCapturer?.stopCapture(); capturing = false }
        pc?.close()
        pc = nil
        pendingCandidates.removeAll()
        hasRemoteDescription = false
        // 关闭所有旁观 PC。
        for (_, opc) in observerPCs { opc.close() }
        observerPCs.removeAll(); observerDelegates.removeAll(); observerHasRemote.removeAll()
        observerPending.removeAll(); observerRemoteTracks.removeAll(); observerRenderers.removeAll()
    }

    // MARK: 旁观（管理员）——隔离的额外 PC，共享本端音视频轨；不触碰主 pc。
    func addObserverPeer(_ peerId: String, offer: Bool) {
        guard observerPCs[peerId] == nil else { return }
        let config = RTCConfiguration()
        config.iceServers = iceConfig.isEmpty
            ? [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
            : iceConfig.map { RTCIceServer(urlStrings: $0.urls, username: $0.username ?? "", credential: $0.credential ?? "") }
        config.sdpSemantics = .unifiedPlan
        let delegate = ObserverPCDelegate(peerId: peerId, engine: self)
        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let opc = Self.factory.peerConnection(with: config, constraints: constraints, delegate: delegate) else { return }
        observerPCs[peerId] = opc
        observerDelegates[peerId] = delegate
        if let a = localAudioTrack { opc.add(a, streamIds: ["obs0"]) }   // 共享本端语音（含管理员说话）
        if let v = localVideoTrack { opc.add(v, streamIds: ["obs0"]) }   // 共享本端视频（仅参与者；isEnabled 随分享门控，管理员见即所见）
        if offer {
            let oc = RTCMediaConstraints(mandatoryConstraints: ["OfferToReceiveAudio": "true", "OfferToReceiveVideo": "true"], optionalConstraints: nil)
            opc.offer(for: oc) { [weak self] sdp, err in
                guard let self, let sdp, err == nil else { return }
                opc.setLocalDescription(sdp) { _ in }
                self.onObserverLocalDescription?(peerId, "offer", sdp.sdp)
            }
        }
    }

    func handleObserverDescription(from peerId: String, type: String, sdp: String) {
        guard let opc = observerPCs[peerId] else { return }
        let rtcType: RTCSdpType = (type == "offer") ? .offer : .answer
        opc.setRemoteDescription(RTCSessionDescription(type: rtcType, sdp: sdp)) { [weak self] error in
            guard let self, error == nil else { return }
            DispatchQueue.main.async {
                self.observerHasRemote[peerId] = true
                for c in self.observerPending[peerId] ?? [] { opc.add(c) { _ in } }
                self.observerPending[peerId] = []
            }
            guard rtcType == .offer else { return }
            let oc = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
            opc.answer(for: oc) { sdp, aerr in
                guard let sdp, aerr == nil else { return }
                opc.setLocalDescription(sdp) { _ in }
                self.onObserverLocalDescription?(peerId, "answer", sdp.sdp)
            }
        }
    }

    func handleObserverCandidate(from peerId: String, candidate: String, sdpMid: String?, sdpMLineIndex: Int32) {
        let c = RTCIceCandidate(sdp: candidate, sdpMLineIndex: sdpMLineIndex, sdpMid: sdpMid)
        if observerHasRemote[peerId] == true { observerPCs[peerId]?.add(c) { _ in } }
        else { observerPending[peerId, default: []].append(c) }
    }

    func setObserverRenderer(_ renderer: RTCVideoRenderer, for peerId: String) {
        DispatchQueue.main.async {
            self.observerRenderers[peerId] = renderer
            self.observerRemoteTracks[peerId]?.add(renderer)
        }
    }

    func removeObserverPeer(_ peerId: String) {
        observerPCs[peerId]?.close()
        observerPCs[peerId] = nil; observerDelegates[peerId] = nil; observerHasRemote[peerId] = nil
        observerPending[peerId] = nil; observerRemoteTracks[peerId] = nil; observerRenderers[peerId] = nil
    }

    // 旁观 PC 的 delegate 回调（在 WebRTC 信令线程）：转回引擎，带 peerId。
    fileprivate func observerDidGenerate(_ peerId: String, _ candidate: RTCIceCandidate) {
        onObserverLocalCandidate?(peerId, candidate.sdp, candidate.sdpMid, candidate.sdpMLineIndex)
    }
    fileprivate func observerDidAddTrack(_ peerId: String, _ track: RTCVideoTrack) {
        DispatchQueue.main.async {
            // 重协商/换轨：先把渲染器从旧轨摘除，避免它继续收旧轨的帧或重复挂载（见复审 LC-4）。
            if let r = self.observerRenderers[peerId], let old = self.observerRemoteTracks[peerId], old !== track {
                old.remove(r)
            }
            self.observerRemoteTracks[peerId] = track
            if let r = self.observerRenderers[peerId] { track.add(r) }
            self.onObserverRemoteVideoTrack?(peerId)
        }
    }

    /// 每 2s 拉一次 WebRTC 统计，用活跃候选对的往返时延映射"信号强弱"。
    private func startStatsPolling() {
        statsTimer?.invalidate()
        statsTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.pollStats() }
    }

    private func pollStats() {
        pc?.statistics { [weak self] report in
            guard let self else { return }
            var rtt: Double?
            for (_, s) in report.statistics where s.type == "candidate-pair" {
                let nominated = (s.values["nominated"] as? NSNumber)?.boolValue ?? false
                let state = s.values["state"] as? String
                guard nominated || state == "succeeded" else { continue }
                if let r = (s.values["currentRoundTripTime"] as? NSNumber)?.doubleValue { rtt = r }
            }
            let quality: CallQuality
            if let rtt {
                quality = rtt < 0.15 ? .good : (rtt < 0.4 ? .fair : .weak)
            } else {
                quality = .unknown
            }
            DispatchQueue.main.async { self.onCallQuality?(quality) }
        }
    }

    /// 协助者侧把远端视频渲染到给定 renderer。
    /// remoteRenderer/remoteVideoTrack 统一在主线程读写，避免与 WebRTC 信令线程回调竞争（见审查 #5）。
    func setRemoteRenderer(_ renderer: RTCVideoRenderer) {
        DispatchQueue.main.async {
            self.remoteRenderer = renderer
            self.remoteVideoTrack?.add(renderer)
        }
    }

    private func startCapture(_ capturer: RTCCameraVideoCapturer) {
        let wanted: AVCaptureDevice.Position = cameraFront ? .front : .back
        let devices = RTCCameraVideoCapturer.captureDevices()
        guard let device = devices.first(where: { $0.position == wanted })
            ?? devices.first(where: { $0.position == .back }) ?? devices.first else { return }
        activeDevice = device // 留存：手电筒/变焦远程控制作用于当前采集设备
        let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
        // 目标 720p（1280 宽）高清：选尺寸最接近 1280 宽的格式（兼顾画质与带宽）。
        let target = 1280
        let format = formats.min(by: {
            let aw = Int(CMVideoFormatDescriptionGetDimensions($0.formatDescription).width)
            let bw = Int(CMVideoFormatDescriptionGetDimensions($1.formatDescription).width)
            return abs(aw - target) < abs(bw - target)
        }) ?? formats.last
        guard let format else { return }
        let fps = format.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 30
        capturer.startCapture(with: device, format: format, fps: Int(min(fps, 30)))
    }

    // MARK: RTCPeerConnectionDelegate
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        onLocalCandidate?(candidate.sdp, candidate.sdpMid, candidate.sdpMLineIndex)
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams: [RTCMediaStream]) {
        if let track = rtpReceiver.track as? RTCVideoTrack {
            // 该回调在 WebRTC 信令线程；统一切到主线程访问 remoteVideoTrack/remoteRenderer（见审查 #5）。
            DispatchQueue.main.async {
                self.remoteVideoTrack = track
                if let renderer = self.remoteRenderer { track.add(renderer) }
                self.onRemoteVideoTrack?()
            }
        }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        // 把真实媒体连通状态报给上层——失败/中断时 UI 才能区别于"信令已连接"，定位无画面（见无画面深审）。
        let mapped: MediaConnState?
        switch newState {
        case .checking, .new: mapped = .connecting
        case .connected, .completed: mapped = .connected
        case .failed: mapped = .failed
        case .disconnected: mapped = .disconnected
        case .closed: mapped = nil
        @unknown default: mapped = nil
        }
        // 连通后开始采质量统计；失败/关闭则停。
        DispatchQueue.main.async {
            switch newState {
            case .connected, .completed: if self.statsTimer == nil { self.startStatsPolling() }
            case .failed, .closed: self.statsTimer?.invalidate(); self.statsTimer = nil
            default: break
            }
        }
        if let mapped { DispatchQueue.main.async { self.onMediaStateChange?(mapped) } }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}

/// 每个旁观 PC 一个 delegate（携带 peerId），把回调转回引擎并标明是哪个对端。
/// RTCPeerConnection 仅弱引用 delegate，故引擎用 observerDelegates 字典强持有。
private final class ObserverPCDelegate: NSObject, RTCPeerConnectionDelegate {
    let peerId: String
    weak var engine: WebRTCMediaEngine?
    init(peerId: String, engine: WebRTCMediaEngine) { self.peerId = peerId; self.engine = engine }
    func peerConnection(_ pc: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) { engine?.observerDidGenerate(peerId, candidate) }
    func peerConnection(_ pc: RTCPeerConnection, didAdd rtpReceiver: RTCRtpReceiver, streams: [RTCMediaStream]) {
        if let t = rtpReceiver.track as? RTCVideoTrack { engine?.observerDidAddTrack(peerId, t) }
    }
    func peerConnection(_ pc: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ pc: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ pc: RTCPeerConnection) {}
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ pc: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ pc: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
#endif
