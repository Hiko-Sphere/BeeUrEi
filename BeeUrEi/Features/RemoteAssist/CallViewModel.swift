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
    private(set) var peerUserId: String?
    private(set) var peerName: String?
    private(set) var reportStatus: String?
    var canReport: Bool { peerUserId != nil }

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
        // 先拉 ICE 服务器并启动媒体引擎，**再**连接/加入信令——否则 await 期间提前到达的 joined
        // 会在 pc 还是 nil 时调 createOffer 而静默落空，视障侧永不发 offer、通话卡死（见审查 #7）。
        if let servers = try? await APIClient().iceServers(token: token) {
            media.setIceServers(servers)
        }
        media.start(asCaller: role == .blind)
        signaling.connect(token: token, baseURL: ServerConfig.baseURL)
        signaling.join(callId: callId, role: role == .blind ? "blind" : "helper")
        statusText = "已加入，等待对方接入…"
    }

    private func handle(_ msg: [String: Any]) {
        switch msg["type"] as? String {
        case "joined":
            // 我加入时若对端已在房间，记录对端 userId/姓名；我是发起方(视障)则发起 offer。
            if let peers = msg["peers"] as? [[String: Any]], let first = peers.first {
                peerUserId = first["userId"] as? String ?? peerUserId
                peerName = first["userName"] as? String ?? peerName
                if role == .blind {
                    connected = true
                    statusText = connectedStatus()
                    media.createOffer()
                }
            }
        case "peer-joined":
            connected = true
            peerUserId = msg["userId"] as? String ?? peerUserId
            peerName = msg["userName"] as? String ?? peerName
            statusText = connectedStatus()
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

    private func connectedStatus() -> String {
        if let peerName, !peerName.isEmpty { return "已连接 · 与\(peerName)" }
        return "已连接"
    }

    /// 举报对方（信任与安全）。
    func report(reason: String) async {
        guard let token = KeychainStore.read(), let target = peerUserId else {
            reportStatus = "暂时无法举报"
            return
        }
        do {
            try await APIClient().submitReport(token: token, targetUserId: target, callId: callId, reason: reason)
            reportStatus = "已举报，感谢反馈"
        } catch {
            reportStatus = "举报失败，请稍后再试"
        }
    }

    func hangUp() {
        signaling.end()
        media.stop()
        signaling.close()
    }
}
