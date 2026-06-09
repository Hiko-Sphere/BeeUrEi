import Foundation
import Observation

/// 通话视图模型：编排信令 + 媒体 + 视频隐私门控。
@MainActor
@Observable
final class CallViewModel {
    enum Role { case blind, helper }

    let role: Role
    let callId: String
    private let waitingText: String   // 等待对端接入时的提示（求助志愿者/呼叫亲友文案不同）
    private(set) var connected = false
    private(set) var videoSending = false
    private(set) var statusText = "正在连接…"
    private(set) var peerUserId: String?
    private(set) var peerName: String?
    private(set) var reportStatus: String?
    private(set) var mediaState: MediaConnState?     // 真实媒体连通状态（区别于信令已连接）
    private(set) var remoteVideoAvailable = false    // 协助者：已收到远端视频轨（轨道存在；是否有画面再看 frames）
    private(set) var remoteVideoFrames = false       // 协助者：远端视频真的有画面帧（对方已开启并在传）
    private(set) var callQuality: CallQuality = .unknown // 通话信号强弱（WebRTC 实测往返时延）
    var canReport: Bool { peerUserId != nil }

    /// 协助者侧画面区的提示文案（把"无画面"的原因讲清楚）。
    var helperVideoHint: String {
        switch mediaState {
        case .failed: return "媒体连接失败。请确保两台手机连同一个 WiFi；跨网络需开启 TURN（见手册 A3）。"
        case .disconnected: return "连接中断，正在尝试恢复…"
        case .connecting, .none: return "正在建立媒体连接…"
        case .connected:
            return remoteVideoFrames ? "正在显示对方画面" : "已连通。等待对方点「显示画面给对方」…"
        }
    }

    @ObservationIgnored private let signaling = SignalingClient()
    @ObservationIgnored let media: MediaEngine = MediaEngineFactory.make()
    @ObservationIgnored private var hasOffered = false // 视障侧是否已发过 offer，防对端重连/重复 peer-joined 在已建立 pc 上重发 offer 造成 glare（见审查 #2）
    @ObservationIgnored private var ended = false // hangUp 幂等：任意路径（按钮/界面消失/CallKit 系统挂断）都能安全调用，确保媒体/信令确定性释放（见复审 #1）

    init(role: Role, callId: String, waitingText: String = "正在接通，请稍候…") {
        self.role = role
        self.callId = callId
        self.waitingText = waitingText
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
        // 真实媒体连通状态：把"信令已连接但媒体没通"暴露出来，让无画面可定位（见无画面深审）。
        media.onMediaStateChange = { [weak self] state in
            guard let self else { return }
            self.mediaState = state
            switch state {
            case .failed:
                self.statusText = "媒体连接失败：请两台手机连同一 WiFi；跨网络需开启 TURN"
            case .connected:
                if self.connected { self.statusText = self.connectedStatus() }
            default:
                break
            }
        }
        media.onRemoteVideoTrack = { [weak self] in self?.remoteVideoAvailable = true }
        media.onCallQuality = { [weak self] q in self?.callQuality = q }

        signaling.onMessage = { [weak self] msg in self?.handle(msg) }
        signaling.onClose = { [weak self] in
            guard let self else { return }
            self.connected = false
            self.statusText = "连接已断开，请重新呼叫"
            // 隐私 fail-safe：信令断开时强制关画面、停相机（setVideoSending(false) 会 disable 视频轨并 stopCapture），
            // 绝不让相机在断线后仍采集/外发（见审查 #5/#8）。
            // 但**不** media.stop() 拆除 pc：信令断开多为瞬时(移动网切换/服务器 reload)，P2P 媒体本身可能仍存活；
            // 立刻拆 pc 会把可恢复断线变成不可恢复的僵尸界面。彻底释放交给用户挂断(hangUp→media.stop)（见回归 #2）。
            self.setVideoSending(false)
        }
        // 先拉 ICE 服务器并启动媒体引擎，**再**连接/加入信令——否则 await 期间提前到达的 joined
        // 会在 pc 还是 nil 时调 createOffer 而静默落空，视障侧永不发 offer、通话卡死（见审查 #7）。
        if let servers = try? await APIClient().iceServers(token: token) {
            media.setIceServers(servers)
        }
        media.start(asCaller: role == .blind)
        signaling.connect(token: token, baseURL: ServerConfig.baseURL)
        signaling.join(callId: callId, role: role == .blind ? "blind" : "helper")
        statusText = waitingText // 寻找志愿者/呼叫亲友显示各自的等待文案，不再笼统说"已加入"
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
            // **不**复位 hasOffered：1:1 协助通话中对端离开即视为本通结束，不尝试在旧 pc 上对新对端重协商
            // ——否则会在残留 hasRemoteDescription/旧 remoteDescription 的 pc 上错配候选致连接退化（见回归 #1/#3）。
            // 如需联系新协助者，用户重新发起呼叫（全新 CallViewModel + 干净 pc）。
        default:
            break
        }
    }

    /// 协助者侧：远端视频出现真实画面帧（由 RemoteVideoView 的尺寸变化回调触发）。
    func markRemoteVideoFrames() { remoteVideoFrames = true }

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

    /// 通话中把对方加为常用亲友/协助者（发起请求，待对方确认）。
    func addPeerAsFriend() async {
        guard let token = KeychainStore.read(), let peer = peerUserId else { return }
        do {
            try await APIClient().addFamilyLink(token: token, userId: peer)
            reportStatus = "已发送添加请求，待对方确认"
        } catch let APIError.server(msg) {
            reportStatus = msg == "already_linked" ? "你们已是亲友/协助者" : (msg == "blocked" ? "无法添加：存在拉黑关系" : "添加失败")
        } catch {
            reportStatus = "添加失败，请重试"
        }
    }

    /// 拉黑对方：之后互不出现在匹配/求助队列/来电中。
    func blockPeer() async {
        guard let token = KeychainStore.read(), let peer = peerUserId else { return }
        do {
            try await APIClient().blockUser(token: token, userId: peer)
            reportStatus = "已拉黑对方，今后将互不匹配/呼叫"
        } catch {
            reportStatus = "拉黑失败，请重试"
        }
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

    /// 结束通话并释放媒体/信令。幂等：可被「挂断按钮」「界面消失(含 CallKit 系统挂断)」重复调用（见复审 #1）。
    func hangUp() {
        guard !ended else { return }
        ended = true
        signaling.end()
        media.stop()
        signaling.close()
    }
}
