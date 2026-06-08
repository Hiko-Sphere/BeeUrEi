import Foundation
import Observation

/// 通话视图模型：编排信令 + 媒体 + 视频隐私门控。
@MainActor
@Observable
final class CallViewModel {
    enum Role { case blind, helper }

    let role: Role
    let callId: String
    private(set) var connected = false
    private(set) var videoSending = false
    private(set) var statusText = "正在连接…"

    @ObservationIgnored private let signaling = SignalingClient()
    @ObservationIgnored let media: MediaEngine = MediaEngineFactory.make()

    init(role: Role, callId: String) {
        self.role = role
        self.callId = callId
    }

    func start() async {
        guard let token = KeychainStore.read() else {
            statusText = "请先在「设置 → 账号」登录后再呼叫"
            return
        }
        // 媒体本端 SDP/ICE → 经信令发给对端。
        media.onLocalDescription = { [weak self] type, sdp in
            self?.signaling.send(["type": type, "sdp": sdp])
        }
        media.onLocalCandidate = { [weak self] candidate, sdpMid, sdpMLineIndex in
            var msg: [String: Any] = ["type": "ice", "candidate": candidate, "sdpMLineIndex": Int(sdpMLineIndex)]
            if let sdpMid { msg["sdpMid"] = sdpMid }
            self?.signaling.send(msg)
        }

        signaling.onMessage = { [weak self] msg in self?.handle(msg) }
        signaling.onClose = { [weak self] in
            self?.connected = false
            self?.statusText = "连接已断开"
        }
        signaling.connect(token: token, baseURL: ServerConfig.baseURL)
        signaling.join(callId: callId, role: role == .blind ? "blind" : "helper")
        // 通话前拉取 ICE 服务器（STUN + 短时效 TURN 凭据），用于 NAT 穿透。
        if let servers = try? await APIClient().iceServers(token: token) {
            media.setIceServers(servers)
        }
        media.start(asCaller: role == .blind)
        statusText = "已加入，等待对方接入…"
    }

    private func handle(_ msg: [String: Any]) {
        switch msg["type"] as? String {
        case "joined":
            // 我加入时若对端已在房间，且我是发起方(视障)，则发起 offer。
            if let peers = msg["peers"] as? [[String: Any]], !peers.isEmpty, role == .blind {
                connected = true
                statusText = "已连接"
                media.createOffer()
            }
        case "peer-joined":
            connected = true
            statusText = "已连接"
            if role == .blind { media.createOffer() }
        case "offer":
            if let sdp = msg["sdp"] as? String { media.handleRemoteDescription(type: "offer", sdp: sdp) }
        case "answer":
            if let sdp = msg["sdp"] as? String { media.handleRemoteDescription(type: "answer", sdp: sdp) }
        case "ice":
            if let candidate = msg["candidate"] as? String {
                media.handleRemoteCandidate(candidate: candidate,
                                            sdpMid: msg["sdpMid"] as? String,
                                            sdpMLineIndex: Int32((msg["sdpMLineIndex"] as? Int) ?? 0))
            }
        case "video-gate":
            if let on = msg["on"] as? Bool { statusText = on ? "对方开启了画面" : "对方关闭了画面" }
        case "peer-left":
            statusText = "对方已离开"
        default:
            break
        }
    }

    /// 视障侧隐私门控：开启/关闭把画面发给对方。
    func setVideoSending(_ sending: Bool) {
        guard role == .blind, sending != videoSending else { return }
        videoSending = sending
        media.setLocalVideoSending(sending)
        signaling.videoGate(on: sending)
    }

    func hangUp() {
        signaling.end()
        media.stop()
        signaling.close()
    }
}
