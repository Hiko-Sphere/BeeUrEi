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
    private let lang = FeatureSettings().language  // 通话内播报语言（E5，开播即定）
    private(set) var connected = false
    private(set) var videoSending = false
    private(set) var statusText = CallStrings.connecting(FeatureSettings().language)
    private(set) var peerUserId: String?
    private(set) var peerName: String?
    private(set) var peerAvatar: String?
    private(set) var reportStatus: String?
    private(set) var mediaState: MediaConnState?     // 真实媒体连通状态（区别于信令已连接）
    private(set) var remoteVideoAvailable = false    // 协助者：已收到远端视频轨（轨道存在；是否有画面再看 frames）
    private(set) var remoteVideoFrames = false       // 协助者：远端视频真的有画面帧（对方已开启并在传）
    private(set) var callQuality: CallQuality = .unknown // 通话信号强弱（WebRTC 实测往返时延）
    private(set) var declined = false                     // 发起方：对方已拒绝
    private(set) var unanswered = false                   // 发起方：40s 无人接听（A4 回退志愿者）
    private(set) var muted = false                        // 本端是否静音
    private(set) var callEnded = false                   // 对方已挂断/离开 → 本端自动挂断并关闭界面
    var canReport: Bool { peerUserId != nil }

    /// 切换静音（禁用/启用本端麦克风音频轨）。
    func setMuted(_ on: Bool) {
        muted = on
        media.setMicMuted(on)
    }

    /// 协助者侧画面区的提示文案（把"无画面"的原因讲清楚）。
    var helperVideoHint: String {
        switch mediaState {
        case .failed: return CallStrings.mediaFailedHint(lang)
        case .disconnected: return CallStrings.reconnecting(lang)
        case .connecting, .none: return CallStrings.establishingMedia(lang)
        case .connected:
            return remoteVideoFrames ? CallStrings.showingPeerVideo(lang) : CallStrings.waitingPeerVideo(lang)
        }
    }

    // F1：信令与媒体可注入（默认生产实现）——通话隐私门控/信令处理由 mock 驱动单测。
    @ObservationIgnored private let signaling: Signaling
    @ObservationIgnored let media: MediaEngine
    @ObservationIgnored private var hasOffered = false // 视障侧是否已发过 offer，防对端重连/重复 peer-joined 在已建立 pc 上重发 offer 造成 glare（见审查 #2）
    @ObservationIgnored private var ended = false // hangUp 幂等：任意路径（按钮/界面消失/CallKit 系统挂断）都能安全调用，确保媒体/信令确定性释放（见复审 #1）

    init(role: Role, callId: String, waitingText: String = CallStrings.defaultWaiting(FeatureSettings().language),
         signaling: Signaling = SignalingClient(), media: MediaEngine = MediaEngineFactory.make()) {
        self.role = role
        self.callId = callId
        self.waitingText = waitingText
        self.signaling = signaling
        self.media = media
    }

    func start() async {
        guard let token = KeychainStore.read() else {
            statusText = CallStrings.loginToCall(lang)
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
                self.statusText = CallStrings.mediaFailedStatus(self.lang)
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
            self.statusText = CallStrings.signalingClosed(self.lang)
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
        if role == .blind { startDeclineWatch(token: token) } // 发起方：轮询"对方是否拒绝"
    }

    /// 发起方等待期间轮询呼叫状态；对方全部拒绝则显示"对方已拒绝"。
    /// 同时跑 40s 无人接听看门狗（A4）：超时置 unanswered，界面据此提供「转向志愿者求助」回退。
    private func startDeclineWatch(token: String) {
        let cid = callId
        Task { [weak self] in
            while true {
                try? await Task.sleep(for: .seconds(2))
                guard let self, !self.connected, !self.ended, !self.declined else { return }
                if await APIClient().callDeclined(token: token, callId: cid) {
                    self.declined = true
                    self.statusText = CallStrings.declined(self.lang)
                    return
                }
            }
        }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(40))
            guard let self, !self.connected, !self.ended, !self.declined, !self.callEnded else { return }
            self.unanswered = true
            self.statusText = CallStrings.unanswered(self.lang)
            A11y.announce(CallStrings.unansweredAnnounce(self.lang))
        }
    }

    /// 信令消息处理。internal 供单测直接驱动（生产路径仍经 start() 里的 signaling.onMessage 接线）。
    func handle(_ msg: [String: Any]) {
        switch msg["type"] as? String {
        case "joined":
            // 我加入时若对端已在房间，记录对端 userId/姓名；我是发起方(视障)则发起 offer。
            if let peers = msg["peers"] as? [[String: Any]], let first = peers.first {
                peerUserId = first["userId"] as? String ?? peerUserId
                peerName = first["userName"] as? String ?? peerName
                peerAvatar = first["userAvatar"] as? String ?? peerAvatar
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
            peerAvatar = msg["userAvatar"] as? String ?? peerAvatar
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
            if let on = msg["on"] as? Bool { statusText = on ? CallStrings.peerVideoOn(lang) : connectedStatus() }
        case "control":
            // 协助者远程控制（Be My Eyes 式）：仅盲人端、且**正在分享画面**时才接受——
            // 不分享时不允许对方动我的手电/相机（隐私与最小权限）。
            guard role == .blind, videoSending else { return }
            if let torch = msg["torch"] as? Bool {
                media.setTorch(torch)
                A11y.announce(CallStrings.announceRemoteTorch(on: torch, lang))
            }
            if let zoom = msg["zoom"] as? Double {
                media.setZoom(zoom)
            }
        case "end", "peer-left":
            // 一方挂断/离开 → 本端自动挂断并关闭界面（见“同时自动挂断”需求）。
            // 'end' 是对方主动挂断的即时通知；'peer-left' 是其连接关闭后服务端补发，二者取先到者。
            endByPeer()
        default:
            break
        }
    }

    /// 对端结束通话：复位隐私门控、置结束标记，界面据此自动关闭。
    private func endByPeer() {
        guard !callEnded else { return }
        setVideoSending(false)
        connected = false
        statusText = CallStrings.peerHungUp(lang)
        A11y.announce(CallStrings.peerHungUp(lang))
        callEnded = true
    }

    /// 协助者侧：远端视频出现真实画面帧（由 RemoteVideoView 的尺寸变化回调触发）。
    func markRemoteVideoFrames() { remoteVideoFrames = true }

    // MARK: 协助者远程控制（手电筒/变焦，Be My Eyes 式）

    private(set) var remoteTorchOn = false   // 协助者视角：对方手电筒是否已被我打开
    private(set) var remoteZoom: Double = 1  // 协助者视角：当前远程变焦倍率

    /// 协助者：远程开/关盲人手电筒（暗光下看不清画面时）。
    func toggleRemoteTorch() {
        guard role == .helper else { return }
        remoteTorchOn.toggle()
        signaling.send(["type": "control", "torch": remoteTorchOn])
    }

    /// 协助者：循环远程变焦 1x→2x→3x→1x（放大看标签/细节）。
    func cycleRemoteZoom() {
        guard role == .helper else { return }
        remoteZoom = remoteZoom >= 3 ? 1 : remoteZoom + 1
        signaling.send(["type": "control", "zoom": remoteZoom])
    }

    private(set) var cameraFront = false // 盲人分享时的摄像头：false=后置(看前方场景) true=前置(看面部)

    /// 切换前/后摄像头（前置=让协助者看到盲人面部）。
    func setCameraFront(_ front: Bool) {
        guard role == .blind, front != cameraFront else { return }
        cameraFront = front
        media.setCameraPosition(front: front)
    }

    /// 视障侧隐私门控：开启/关闭把画面发给对方。
    func setVideoSending(_ sending: Bool) {
        guard role == .blind, sending != videoSending else { return }
        videoSending = sending
        media.setLocalVideoSending(sending)
        signaling.videoGate(on: sending)
    }

    private func connectedStatus() -> String {
        CallStrings.connectedWith(peerName, lang)
    }

    /// 通话中把对方加为常用亲友/协助者（发起请求，待对方确认）。
    func addPeerAsFriend() async {
        guard let token = KeychainStore.read(), let peer = peerUserId else { return }
        do {
            try await APIClient().addFamilyLink(token: token, userId: peer)
            reportStatus = CallStrings.addRequestSent(lang)
        } catch let APIError.server(msg) {
            reportStatus = msg == "already_linked" ? CallStrings.alreadyLinked(lang)
                : (msg == "blocked" ? CallStrings.blockedRelation(lang) : CallStrings.addFailed(lang))
        } catch {
            reportStatus = CallStrings.addFailedRetry(lang)
        }
    }

    /// 拉黑对方：之后互不出现在匹配/求助队列/来电中。
    func blockPeer() async {
        guard let token = KeychainStore.read(), let peer = peerUserId else { return }
        do {
            try await APIClient().blockUser(token: token, userId: peer)
            reportStatus = CallStrings.blockedOk(lang)
        } catch {
            reportStatus = CallStrings.blockFailed(lang)
        }
    }

    /// 举报对方（信任与安全）。
    func report(reason: String) async {
        guard let token = KeychainStore.read(), let target = peerUserId else {
            reportStatus = CallStrings.cantReport(lang)
            return
        }
        do {
            try await APIClient().submitReport(token: token, targetUserId: target, callId: callId, reason: reason)
            reportStatus = CallStrings.reported(lang)
        } catch {
            reportStatus = CallStrings.reportFailed(lang)
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
