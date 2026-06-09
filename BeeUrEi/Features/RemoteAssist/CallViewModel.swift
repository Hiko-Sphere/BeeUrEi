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
    @ObservationIgnored private var hasOffered = false // 视障侧是否已发过 offer，防对端重连/重复 peer-joined 在已建立 pc 上重发 offer 造成 glare（见审查 #2）

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
            guard let self else { return }
            self.connected = false
            self.statusText = "连接已断开，请重新呼叫"
            // 信令断开可能是"幽灵通话"：强制关画面(隐私 fail-safe)并释放媒体，绝不让相机在断线后仍采集/外发（见审查 #5/#8）。
            self.setVideoSending(false)
            self.media.stop()
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
                // 对端已在房间→双方都标记已连接(否则后加入的协助者 UI 永久卡在"等待接入"，见审查 #2)；
                // 但只有发起方(视障)才发 offer。
                connected = true
                statusText = connectedStatus()
                // 仅在尚未发过 offer 时才发，避免对端重连/重复消息在已建立的 pc 上重发 offer 造成 glare（见审查 #2）。
                if role == .blind, !hasOffered { hasOffered = true; media.createOffer() }
            }
        case "peer-joined":
            // 新对端接入：默认不发画面，须重新按住才发——避免沿用上一个对端时的发送状态把画面直接推给新对端（隐私默认关，见审查 #4）。
            setVideoSending(false)
            connected = true
            peerUserId = msg["userId"] as? String ?? peerUserId
            peerName = msg["userName"] as? String ?? peerName
            statusText = connectedStatus()
            if role == .blind, !hasOffered { hasOffered = true; media.createOffer() }
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
            // 关闭画面时恢复"已连接"，避免状态栏永久停在"对方关闭了画面"让协助者误以为掉线（见审查 #3）。
            if let on = msg["on"] as? Bool { statusText = on ? "已连接 · 对方已开启画面" : connectedStatus() }
        case "peer-left":
            statusText = "对方已离开"
            setVideoSending(false)      // 对端离开：复位隐私门控，画面默认不外发（见审查 #4）
            connected = false
            peerUserId = nil            // 清空，避免举报指向已离开者 / 新对端沿用旧 id（见审查 #7）
            peerName = nil
            hasOffered = false          // 允许对新对端重新协商
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
