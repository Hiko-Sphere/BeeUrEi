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
    private(set) var remoteVideoTrack: RTCVideoTrack?
    private weak var remoteRenderer: RTCVideoRenderer?
    private var asCaller = false
    private var iceConfig: [IceServerInfo] = []

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
            startCapture(capturer)
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
        pc?.setRemoteDescription(RTCSessionDescription(type: rtcType, sdp: sdp)) { [weak self] _ in
            guard let self, rtcType == .offer else { return }
            let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
            self.pc?.answer(for: constraints) { sdp, _ in
                guard let sdp else { return }
                self.pc?.setLocalDescription(sdp) { _ in }
                self.onLocalDescription?("answer", sdp.sdp)
            }
        }
    }

    func handleRemoteCandidate(candidate: String, sdpMid: String?, sdpMLineIndex: Int32) {
        pc?.add(RTCIceCandidate(sdp: candidate, sdpMLineIndex: sdpMLineIndex, sdpMid: sdpMid)) { _ in }
    }

    func setLocalVideoSending(_ sending: Bool) {
        localVideoTrack?.isEnabled = sending
    }

    func stop() {
        videoCapturer?.stopCapture()
        pc?.close()
        pc = nil
    }

    /// 协助者侧把远端视频渲染到给定 renderer。
    func setRemoteRenderer(_ renderer: RTCVideoRenderer) {
        remoteRenderer = renderer
        remoteVideoTrack?.add(renderer)
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
            remoteVideoTrack = track
            if let renderer = remoteRenderer { track.add(renderer) }
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
