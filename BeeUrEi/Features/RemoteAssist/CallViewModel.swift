import Foundation
import Observation
import UIKit
import CoreLocation
import AVFoundation

/// 通话视图模型：编排信令 + 媒体 + 视频隐私门控。
@MainActor
@Observable
final class CallViewModel {
    enum Role { case blind, helper, adminObserver } // adminObserver：管理员旁观（合规监管，会通知双方）

    // MARK: 管理员旁观状态
    private(set) var adminObserving = false        // 参与方：当前有管理员在监看本次通话（据此显示不可关闭的告知横幅+语音）
    private(set) var adminObserverName: String?     // 监看的管理员显示名
    /// 管理员侧：被监看的参与者（含是否已收到其视频帧），供观察界面渲染。
    private(set) var observedPeers: [ObservedPeer] = []
    struct ObservedPeer: Identifiable { let id: String; var name: String; var role: String; var hasVideo: Bool }
    @ObservationIgnored private var adminObserverId: String? // 参与方：监看本通话的管理员 userId（区分 peer-left 是管理员退出还是对端挂断）

    /// 通话状态播报：VoiceOver 走系统公告；盲人未开 VoiceOver 时用 App TTS 念出（A11y.announce 在未开 VO 时被静默丢弃，见 P1 审计）。
    private func announce(_ text: String) {
        A11y.announce(text)
        if role == .blind, !UIAccessibility.isVoiceOverRunning {
            SpeechHub.shared.speak(text, channel: .call, voiceCode: lang.voiceCode)
        }
    }

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
    // 盲人看不到信号格：把"转弱/从弱恢复"用语音告诉盲人（防抖判定在核心可单测）。协助者侧 SpeechHub 静默、不受扰。
    private var qualityAnnouncer = CallQualityAnnouncer()
    private(set) var declined = false                     // 发起方：对方已拒绝
    private(set) var unanswered = false                   // 发起方：40s 无人接听（A4 回退志愿者）
    private(set) var muted = false                        // 本端是否静音
    private(set) var micDenied = false                    // 麦克风权限被拒：对端听不到本端，须持续提示（见网页端对齐）
    private(set) var callEnded = false                   // 对方已挂断/离开 → 本端自动挂断并关闭界面
    var canReport: Bool { peerUserId != nil }

    // MARK: 通话内实时文字（RTT）——随音视频并行的文字通道（服务端 in-call-text，EN 301 549 total conversation）

    struct CallTextMessage: Identifiable, Equatable {
        let id: String
        let text: String
        let mine: Bool
        var fromAdmin = false // 旁观管理员发的介入文字（气泡与播报须如实归属，不得冒名"对方"）
        var failed: String?  // 服务端拒绝原因（content_blocked / rate_limited / invalid_text）
    }
    private(set) var callTexts: [CallTextMessage] = []
    private(set) var unreadTexts = 0          // 文字面板未打开时收到的条数（按钮角标）
    private(set) var textPanelOpen = false

    func setTextPanelOpen(_ open: Bool) {
        textPanelOpen = open
        if open { unreadTexts = 0 }
    }

    /// 发送通话内文字。客户端先按服务端同口径校验（trim 非空且 UTF-16 码元 ≤500——服务端/web 都按
    /// JS length 计数，字素簇计数会放行 emoji 长文再被服务端拒），无效或未接通返回 false，
    /// **并播报可行动原因**（盲人按下发送后不能没有任何动静）。
    /// 气泡先落本地，若服务端拒绝（违禁词/限速）会经 in-call-text-rejected 回执标记为未发送。
    func sendCallText(_ text: String) -> Bool {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard connected else { announce(CallStrings.textNotConnected(lang)); return false }
        guard !clean.isEmpty, clean.utf16.count <= 500 else {
            if !clean.isEmpty { announce(CallStrings.callTextRejected("invalid_text", lang)) }
            return false
        }
        let id = UUID().uuidString
        callTexts.append(CallTextMessage(id: id, text: clean, mine: true))
        signaling.send(["type": "in-call-text", "text": clean, "id": id])
        return true
    }

    // MARK: 通话录制（Q6，知情同意握手 + ReplayKit 采集）
    private(set) var recordingPolicy = RemoteRecordingPolicy()  // 全站录制策略（开播时拉取；默认 fail-safe 关闭+需同意）
    private(set) var isRecording = false                        // 本端正在录制
    private(set) var peerRecording = false                      // 对端正在录制本次通话
    private(set) var awaitingRecordConsent = false             // 本端已请求录制，等待对端同意
    private(set) var incomingRecordRequest = false            // 对端请求录制，待本端在 RecordingConsentView 选择
    private(set) var recordStatus: String?                     // 录制相关的临时状态文案
    private(set) var lastRecordingId: String?                  // 本次通话最近一条录制的 id（可作为举报证据附上）
    var hasRecordingEvidence: Bool { lastRecordingId != nil }  // 是否有可作证据的录制（举报弹层据此显示"附录制"开关）
    @ObservationIgnored private var recordingStartedAt: Date?  // 录制开始时刻（算时长用）
    @ObservationIgnored private let recorder = CallRecorder()
    /// 是否可发起录制：策略开启 + 设备支持 + 已接通且知道对端 + 当前未在录/未在等同意。
    var canStartRecording: Bool {
        recordingPolicy.enabled && recorder.isAvailable && connected && peerUserId != nil
            && !isRecording && !awaitingRecordConsent && !callEnded
    }

    /// 切换静音（禁用/启用本端麦克风音频轨）。
    func setMuted(_ on: Bool) {
        muted = on
        media.setMicMuted(on)
    }

    /// 通话前确保麦克风权限：未决则请求，被拒则置 micDenied 并播报（盲人侧）。
    private func ensureMicPermission() async {
        switch AVAudioApplication.shared.recordPermission {
        case .denied:
            micDenied = true
            announce(CallStrings.micDeniedAnnounce(lang))
        case .undetermined:
            let granted = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
                AVAudioApplication.requestRecordPermission { c.resume(returning: $0) }
            }
            if !granted { micDenied = true; announce(CallStrings.micDeniedAnnounce(lang)) }
        default:
            break
        }
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
        // 麦克风权限预检：通话靠语音沟通，被拒会"白说"（对端完全听不到）。旁观者纯监看不需麦。
        // undetermined 先请求；denied 持续提示（横幅 + 盲人侧语音），不卡断通话（仍可只听对方）。
        if role != .adminObserver { await ensureMicPermission() }
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
        media.onCallQuality = { [weak self] q in
            guard let self else { return }
            self.callQuality = q
            guard !self.ended, !self.callEnded else { return } // 通话已结束(本端挂断 或 对方/管理员结束)：不再播报信号（防残留回调播"信号弱"，见自审 #3）
            let level: CallSignalLevel
            switch q { case .good: level = .good; case .fair: level = .fair; case .weak: level = .weak; case .unknown: level = .unknown }
            if let phrase = self.qualityAnnouncer.update(level, language: self.lang) {
                SpeechHub.shared.speak(phrase, channel: .call, voiceCode: self.lang.voiceCode)
            }
        }
        // 旁观媒体（与 1:1 主通道隔离）：本端 obs SDP/ICE 经信令**定向**发给对应 peer。
        media.onObserverLocalDescription = { [weak self] peerId, type, sdp in
            self?.signaling.send(["type": type == "offer" ? "obs-offer" : "obs-answer", "to": peerId, "sdp": sdp])
        }
        media.onObserverLocalCandidate = { [weak self] peerId, candidate, sdpMid, sdpMLineIndex in
            var m: [String: Any] = ["type": "obs-ice", "to": peerId, "candidate": candidate, "sdpMLineIndex": Int(sdpMLineIndex)]
            if let sdpMid { m["sdpMid"] = sdpMid }
            self?.signaling.send(m)
        }
        media.onObserverRemoteVideoTrack = { [weak self] peerId in
            guard let self, let i = self.observedPeers.firstIndex(where: { $0.id == peerId }) else { return }
            self.observedPeers[i].hasVideo = true
        }

        signaling.onMessage = { [weak self] msg in self?.handle(msg) }
        signaling.onClose = { [weak self] in
            guard let self else { return }
            self.connected = false
            self.statusText = CallStrings.signalingClosed(self.lang)
            // 管理员旁观者：信令断开即监看结束（可能是被服务端拒绝准入，如已有旁观/通话已结束/能力不符）。
            // 旁观端无本地媒体需保全，直接自动收起界面，避免卡在"信令已断开"（见复审 LC-5）。
            if self.role == .adminObserver { self.callEnded = true; return }
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
        // 录制策略（全站开关 + 是否需同意）：决定是否显示录制按钮、是否走同意握手。失败按默认（关闭+需同意）。
        if let cfg = try? await APIClient().appConfig(token: token) { recordingPolicy = cfg.recording }
        // 若在上面各 await（麦克风授权弹窗可长时间停留、拉 ICE、拉配置）期间已挂断/界面消失（ended），
        // 绝不再启动媒体引擎与信令——否则会在 hangUp() 之后建出**无人再释放**的相机/麦克风采集 + WebSocket
        // + 房间 join：相机在用户已取消后仍采集（隐私）、服务端以为参与者仍在。与 web CallEngine 同类竞态对齐。
        guard !ended else { return }
        media.start(asCaller: role == .blind)
        signaling.connect(token: token, baseURL: ServerConfig.baseURL)
        if role == .adminObserver {
            setMuted(true)                       // 旁观默认静音：先监看，需要时再开麦说话
            signaling.joinAsObserver(callId: callId)
            statusText = CallStrings.observerConnecting(lang)
        } else {
            signaling.join(callId: callId, role: role == .blind ? "blind" : "helper")
            statusText = waitingText // 寻找志愿者/呼叫亲友显示各自的等待文案，不再笼统说"已加入"
            if role == .blind { startDeclineWatch(token: token) } // 发起方：轮询"对方是否拒绝"
        }
    }

    /// 发起方等待期间轮询呼叫状态；对方全部拒绝则**语音提示并自动收线**（双侧都退出来电提示）。
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
                    // 语音走全局总线 .call 通道：避障/导航/识别正在播报时不重叠（让位或被让位）。
                    SpeechHub.shared.speak(CallStrings.declinedSpeak(self.lang), channel: .call)
                    // 留 2.5s 让红字可见/语音起播，然后自动退出呼叫界面（语音不随界面关闭而中断）。
                    try? await Task.sleep(for: .seconds(2.5))
                    if !self.connected, !self.ended { self.callEnded = true } // CallView 观察其变化 → onClose
                    return
                }
            }
        }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(40))
            guard let self, !self.connected, !self.ended, !self.declined, !self.callEnded else { return }
            self.unanswered = true
            self.statusText = CallStrings.unanswered(self.lang)
            self.announce(CallStrings.unansweredAnnounce(self.lang))
        }
    }

    /// 信令消息处理。internal 供单测直接驱动（生产路径仍经 start() 里的 signaling.onMessage 接线）。
    func handle(_ msg: [String: Any]) {
        switch msg["type"] as? String {
        case "joined":
            // 管理员旁观者加入：登记被监看的参与者，等其向我发 obs-offer（既有参与者向新加入者发起）。
            if role == .adminObserver {
                connected = true
                let peers = (msg["peers"] as? [[String: Any]]) ?? []
                observedPeers = peers.compactMap { p in
                    guard let id = p["userId"] as? String else { return nil }
                    return ObservedPeer(id: id, name: (p["userName"] as? String) ?? id, role: (p["role"] as? String) ?? "", hasVideo: false)
                }
                for p in observedPeers { media.addObserverPeer(p.id, offer: false) }
                statusText = CallStrings.observerWatching(lang)
                return
            }
            // 我加入时若对端已在房间，记录对端 userId/姓名；我是发起方(视障)则发起 offer。
            let peers = (msg["peers"] as? [[String: Any]]) ?? []
            // 若已有管理员在监看：登记并向其发 obs-offer，但**不**当作通话对端。
            if let adminP = peers.first(where: { ($0["role"] as? String) == "admin" }) {
                adminObserverId = adminP["userId"] as? String
                adminObserving = true
                adminObserverName = adminP["userName"] as? String
                if let aid = adminObserverId { media.addObserverPeer(aid, offer: true) }
                announce(CallStrings.adminObservingAnnounce(lang)) // 进入时若已被监看，同样告知（合规：参与方必知情）
            }
            if let first = peers.first(where: { ($0["role"] as? String) != "admin" }) {
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
            // 管理员加入监看本次通话（合规：参与方必被告知）。不当作通话对端，向其发 obs-offer 推送本端音视频。
            if (msg["role"] as? String) == "admin" {
                let newId = msg["userId"] as? String
                // 防御：若先前监看的管理员未发 peer-left 即被新管理员替换，先撤旧旁观 PC，避免其残留接收画面（见复审 LC-6）。
                if let old = adminObserverId, old != newId { media.removeObserverPeer(old) }
                adminObserverId = newId
                adminObserving = true
                adminObserverName = msg["userName"] as? String
                if let aid = adminObserverId { media.addObserverPeer(aid, offer: true) }
                announce(CallStrings.adminObservingAnnounce(lang))
                return
            }
            // 管理员侧：有（晚到的）参与者加入 → 登记并向其发 obs-offer。
            if role == .adminObserver {
                if let id = msg["userId"] as? String {
                    if !observedPeers.contains(where: { $0.id == id }) {
                        observedPeers.append(ObservedPeer(id: id, name: (msg["userName"] as? String) ?? id, role: (msg["role"] as? String) ?? "", hasVideo: false))
                    }
                    media.addObserverPeer(id, offer: true)
                }
                return
            }
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
                announce(CallStrings.announceRemoteTorch(on: torch, lang))
            }
            if let zoom = msg["zoom"] as? Double {
                media.setZoom(zoom)
            }
        case "in-call-text":
            // 通话内文字：入列 + 未读计数；盲人侧把内容念出来（双通道），别让文字静默躺在没打开的面板里。
            // id 本地生成（不信任远端 id——多发送者/重放可撞 Identifiable id）；发送者据 from 如实归属：
            // 旁观管理员的介入文字必须标注并播报"管理员"，冒名"对方"是对以语音为唯一通道的盲人的错误陈述。
            guard let text = msg["text"] as? String, !text.isEmpty else { return }
            let fromAdmin = adminObserverId != nil && (msg["from"] as? String) == adminObserverId
            callTexts.append(CallTextMessage(id: UUID().uuidString, text: text, mine: false, fromAdmin: fromAdmin))
            if !textPanelOpen { unreadTexts += 1 }
            announce(fromAdmin ? CallStrings.incomingAdminText(text, lang) : CallStrings.incomingCallText(text, lang))
        case "in-call-text-rejected":
            // 本端文字被服务端拒绝（违禁词/限速/无效）：标记对应气泡 + 播报可行动原因。
            let reason = (msg["reason"] as? String) ?? "invalid_text"
            if let id = msg["id"] as? String, let i = callTexts.firstIndex(where: { $0.id == id }) {
                callTexts[i].failed = reason
            }
            announce(CallStrings.callTextRejected(reason, lang))
        case "record-request":
            // 对端请求录制（要录到含本端画面/语音的通话）→ 弹出知情同意，由本端决定是否同意。
            guard !incomingRecordRequest, !peerRecording else { return }
            incomingRecordRequest = true
            announce(CallStrings.recordPeerAsking(lang))
        case "record-consent":
            // 对端对**我方**的录制请求作出答复。
            guard awaitingRecordConsent, let accepted = msg["accepted"] as? Bool else { return }
            awaitingRecordConsent = false
            recordStatus = nil
            if accepted {
                Task { await beginRecording() }
            } else {
                announce(CallStrings.recordDeclinedByPeer(lang))
            }
        case "record-state":
            // 对端开始/停止了录制 → 更新指示并播报（让被录方始终知情）。
            if let on = msg["recording"] as? Bool {
                peerRecording = on
                announce(on ? CallStrings.recordPeerStarted(lang) : CallStrings.recordPeerStopped(lang))
            }
        case "obs-offer":
            if let from = msg["from"] as? String, let sdp = msg["sdp"] as? String { media.handleObserverDescription(from: from, type: "offer", sdp: sdp) }
        case "obs-answer":
            if let from = msg["from"] as? String, let sdp = msg["sdp"] as? String { media.handleObserverDescription(from: from, type: "answer", sdp: sdp) }
        case "obs-ice":
            if let from = msg["from"] as? String, let candidate = msg["candidate"] as? String {
                media.handleObserverCandidate(from: from, candidate: candidate, sdpMid: msg["sdpMid"] as? String, sdpMLineIndex: Int32((msg["sdpMLineIndex"] as? Int) ?? 0))
            }
        case "end", "peer-left":
            let leaver = msg["userId"] as? String
            // 明确结束（对端挂断 / 管理员强制结束）→ 所有人（含旁观管理员）退出。
            if (msg["type"] as? String) == "end" { endByPeer(); return }
            // 以下为 peer-left（连接关闭后补发）：
            // 管理员退出监看 → 仅清监看态并撤其旁观 PC，通话继续（不可把"管理员走了"当成"对端挂断"）。
            if let leaver, leaver == adminObserverId {
                adminObserving = false; adminObserverName = nil; adminObserverId = nil
                media.removeObserverPeer(leaver)
                announce(CallStrings.adminLeftAnnounce(lang))
                return
            }
            // 管理员侧：某参与者离开 → 撤其旁观 PC；参与者全离开则结束观察。
            if role == .adminObserver {
                if let leaver { media.removeObserverPeer(leaver); observedPeers.removeAll { $0.id == leaver } }
                if observedPeers.isEmpty { callEnded = true }
                return
            }
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
        announce(CallStrings.peerHungUp(lang))
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
    func report(reason: String, attachRecording: Bool = false) async {
        guard let token = KeychainStore.read(), let target = peerUserId else {
            reportStatus = CallStrings.cantReport(lang)
            return
        }
        do {
            // 可附本次通话录制作为证据（仅当存在录制且用户勾选）。
            try await APIClient().submitReport(token: token, targetUserId: target, callId: callId, reason: reason,
                                               evidenceRecordingId: attachRecording ? lastRecordingId : nil)
            reportStatus = CallStrings.reported(lang)
        } catch {
            reportStatus = CallStrings.reportFailed(lang)
        }
    }

    // MARK: 录制控制（发起方）

    /// 发起录制：策略需同意则走"请求→对端同意→开录"握手；否则直接开录。consentBy 含对端 id（满足服务端校验）。
    func requestRecording() {
        guard recordingPolicy.enabled else { announce(CallStrings.recordDisabled(lang)); return }
        guard recorder.isAvailable else { announce(CallStrings.recordUnavailable(lang)); return }
        guard canStartRecording, peerUserId != nil else { return }
        if recordingPolicy.requireConsent {
            awaitingRecordConsent = true
            recordStatus = CallStrings.recordRequesting(lang)
            signaling.send(["type": "record-request"])
            announce(CallStrings.recordRequesting(lang))
        } else {
            Task { await beginRecording() }
        }
    }

    /// 对端请求录制时本端的答复（RecordingConsentView 的回调）：把同意/拒绝**经鉴权端点告知服务端**
    /// （服务端权威核验），同时回传 P2P 让对端尽快开录/收到拒绝。幂等：仅在确有待答复请求时执行一次。
    func respondToRecordRequest(_ accepted: Bool) {
        guard incomingRecordRequest else { return }
        incomingRecordRequest = false
        let cid = callId
        if let token = KeychainStore.read() {
            Task { try? await APIClient().grantRecordingConsent(token: token, callId: cid, granted: accepted) }
        }
        signaling.send(["type": "record-consent", "accepted": accepted])
    }

    /// 停止录制 → 通知对端 → 上传并登记。
    func stopRecording() {
        guard isRecording else { return }
        isRecording = false
        signaling.send(["type": "record-state", "recording": false])
        Task { await finishAndUpload() }
    }

    /// 真正开始 ReplayKit 录制；成功后通知对端并播报。失败诚实播报，不留"假装在录"。
    private func beginRecording() async {
        do {
            try await recorder.start()
            // 若录制启动的 await（ReplayKit 首次授权弹窗/系统启动可停留）期间通话已结束：hangUp() 当时看到
            // VM 的 isRecording 还是 false、没停到本录制器——此处必须立刻停采集并丢弃，绝不让 ReplayKit 在
            // 通话结束后继续录屏（隐私泄漏）。与 start()/refreshMe 同类"await 后重检 ended/登出态"的守卫。
            if ended { await recorder.cancel(); return }
            isRecording = true
            recordingStartedAt = Date() // 算时长
            recordStatus = nil
            signaling.send(["type": "record-state", "recording": true])
            announce(CallStrings.recordStartedAnnounce(lang))
        } catch CallRecorder.RecorderError.unavailable {
            announce(CallStrings.recordUnavailable(lang))
        } catch {
            announce(CallStrings.recordSaveFailed(lang))
        }
    }

    /// 停止采集 → 上传 .mov → 登记录制元数据（consentBy 由服务端据同意登记表权威填充）。临时文件用后即删。
    private func finishAndUpload() async {
        guard let token = KeychainStore.read() else { return }
        let started = recordingStartedAt
        recordingStartedAt = nil
        do {
            let url = try await recorder.stop()
            defer { try? FileManager.default.removeItem(at: url) }
            let data = try Data(contentsOf: url)
            let mediaId = try await APIClient().uploadMedia(token: token, data: data, mime: "video/quicktime")
            // 详细元数据：时长（录制起止差）+ 位置（best-effort，仅已授权时；不弹新框）。
            let durationSec = started.map { max(0, Int(Date().timeIntervalSince($0))) }
            let loc = await bestEffortLocation()
            let rid = try await APIClient().createRecording(token: token, callId: callId, reason: "call", mediaId: mediaId,
                                                            durationSec: durationSec, lat: loc?.lat, lon: loc?.lng, locationLabel: loc?.name)
            if let rid { lastRecordingId = rid } // 供"附为举报证据"引用
            announce(CallStrings.recordStoppedAnnounce(lang))
        } catch {
            announce(CallStrings.recordSaveFailed(lang))
        }
    }

    /// 录制位置（best-effort）："时间地点人"中的"地"。仅在定位**已授权**时采集——绝不在通话中弹新授权框。
    private func bestEffortLocation() async -> LocationPayload? {
        let status = CLLocationManager().authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else { return nil }
        return await LocationShareFetcher().fetch(timeout: 5)
    }

    /// 结束通话并释放媒体/信令。幂等：可被「挂断按钮」「界面消失(含 CallKit 系统挂断)」重复调用（见复审 #1）。
    func hangUp() {
        guard !ended else { return }
        ended = true
        // 录制中挂断：先停录并尽力上传（HTTP 独立于信令/媒体，关闭后仍可完成），不丢证据。
        if isRecording { isRecording = false; Task { await finishAndUpload() } }
        // 管理员旁观者「结束监看」/界面消失只应离场，**绝不**给参与者发 end 结束他人通话——
        // 强制结束是单独的显式动作（forceEndObservedCall）。
        if role != .adminObserver { signaling.end() }
        media.stop()
        signaling.close()
    }

    /// 管理员旁观者：强制结束被监看的整通通话（合规：参与方已被告知正在监看，且会收到结束）。
    /// 走鉴权 REST（服务端 callControl.endCall 权威地向房间各端发 end）——可靠地结束，
    /// 不依赖本端 WS 帧与 close 的时序（本端 socket 立即关闭可能丢掉未发出的 end，见复审 LC-1）。
    func forceEndObservedCall() {
        guard role == .adminObserver, !ended else { return }
        let cid = callId
        if let token = KeychainStore.read() {
            Task { try? await APIClient().adminEndCall(token: token, callId: cid) }
        }
        hangUp() // 释放本端旁观资源（adminObserver 的 hangUp 不再发 WS end）
    }
}
