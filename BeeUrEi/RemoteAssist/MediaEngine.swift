import Foundation

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

    func setIceServers(_ servers: [IceServerInfo])
    func start(asCaller: Bool)
    func createOffer()
    func handleRemoteDescription(type: String, sdp: String)
    func handleRemoteCandidate(candidate: String, sdpMid: String?, sdpMLineIndex: Int32)
    func setLocalVideoSending(_ sending: Bool)
    func stop()
}

/// 占位实现：无 WebRTC 包时使用——信令/UI/隐私门控可端到端联调（不传真实媒体）。
final class StubMediaEngine: MediaEngine {
    var onLocalDescription: ((String, String) -> Void)?
    var onLocalCandidate: ((String, String?, Int32) -> Void)?
    func setIceServers(_ servers: [IceServerInfo]) {}
    func start(asCaller: Bool) {}
    func createOffer() {}
    func handleRemoteDescription(type: String, sdp: String) {}
    func handleRemoteCandidate(candidate: String, sdpMid: String?, sdpMLineIndex: Int32) {}
    func setLocalVideoSending(_ sending: Bool) {}
    func stop() {}
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

/// 自托管 WebRTC：P2P 1:1。STUN 用公共，TURN 待接自托管 coturn。
final class WebRTCMediaEngine: NSObject, MediaEngine, RTCPeerConnectionDelegate {
    var onLocalDescription: ((String, String) -> Void)?
    var onLocalCandidate: ((String, String?, Int32) -> Void)?

    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        return RTCPeerConnectionFactory(encoderFactory: RTCDefaultVideoEncoderFactory(),
                                        decoderFactory: RTCDefaultVideoDecoderFactory())
    }()

    private var pc: RTCPeerConnection?
    private var localVideoTrack: RTCVideoTrack?
    private var videoCapturer: RTCCameraVideoCapturer?
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

    func start(asCaller: Bool) {
        self.asCaller = asCaller
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

        if asCaller {
            // 视障侧：加摄像头视频轨，但默认 disabled（不输出画面）。
            let videoSource = Self.factory.videoSource()
            let capturer = RTCCameraVideoCapturer(delegate: videoSource)
            let videoTrack = Self.factory.videoTrack(with: videoSource, trackId: "video0")
            videoTrack.isEnabled = false
            pc?.add(videoTrack, streamIds: ["stream0"])
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
        pc?.offer(for: constraints) { [weak self] sdp, _ in
            guard let self, let sdp else { return }
            self.pc?.setLocalDescription(sdp) { _ in }
            self.onLocalDescription?("offer", sdp.sdp)
        }
    }

    func handleRemoteDescription(type: String, sdp: String) {
        let rtcType: RTCSdpType = (type == "offer") ? .offer : .answer
        pc?.setRemoteDescription(RTCSessionDescription(type: rtcType, sdp: sdp)) { [weak self] error in
            guard let self else { return }
            if error == nil {
                // remoteDescription 已就位：在主线程 flush 之前缓存的早到候选（见审查 #1）。
                DispatchQueue.main.async {
                    self.hasRemoteDescription = true
                    for c in self.pendingCandidates { self.pc?.add(c) { _ in } }
                    self.pendingCandidates.removeAll()
                }
            }
            // 收到 offer 且设置成功 → 本端回 answer。
            guard rtcType == .offer, error == nil else { return }
            let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
            self.pc?.answer(for: constraints) { sdp, _ in
                guard let sdp else { return }
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
        } else if capturing {
            videoCapturer?.stopCapture()
            capturing = false
        }
    }

    func stop() {
        if capturing { videoCapturer?.stopCapture(); capturing = false }
        pc?.close()
        pc = nil
        pendingCandidates.removeAll()
        hasRemoteDescription = false
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
        let devices = RTCCameraVideoCapturer.captureDevices()
        guard let device = devices.first(where: { $0.position == .back }) ?? devices.first else { return }
        let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
        let format = formats.first(where: {
            CMVideoFormatDescriptionGetDimensions($0.formatDescription).width >= 640
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
            }
        }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
#endif
