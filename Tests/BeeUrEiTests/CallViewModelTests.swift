import XCTest
@testable import BeeUrEi

/// F1 第二批：CallViewModel 信令处理与隐私门控单测（mock Signaling/MediaEngine 注入）。
/// 这些是安全攸关行为：新对端默认不发画面、远程控制最小权限、对端挂断的隐私复位、offer 防 glare。
private final class MockSignaling: Signaling {
    var onMessage: (([String: Any]) -> Void)?
    var onClose: (() -> Void)?
    var joined: [(callId: String, role: String)] = []
    var videoGates: [Bool] = []
    var sent: [[String: Any]] = []
    var endCount = 0
    var closeCount = 0
    var observerJoins: [String] = []
    func connect(token: String, baseURL: URL) {}
    func join(callId: String, role: String) { joined.append((callId, role)) }
    func joinAsObserver(callId: String) { observerJoins.append(callId) }
    func videoGate(on: Bool) { videoGates.append(on) }
    func end() { endCount += 1 }
    func send(_ obj: [String: Any]) { sent.append(obj) }
    func close() { closeCount += 1 }
}

private final class MockMediaEngine: MediaEngine {
    var onLocalDescription: ((String, String) -> Void)?
    var onLocalCandidate: ((String, String?, Int32) -> Void)?
    var onMediaStateChange: ((MediaConnState) -> Void)?
    var onRemoteVideoTrack: (() -> Void)?
    var onCallQuality: ((CallQuality) -> Void)?
    var offerCount = 0
    var videoSendingCalls: [Bool] = []
    var torch: Bool?
    var zoom: Double?
    var muted: Bool?
    var remoteDescriptions: [(type: String, sdp: String)] = []
    var remoteCandidates: [String] = []
    var stopCount = 0
    func setIceServers(_ servers: [IceServerInfo]) {}
    func start(asCaller: Bool) {}
    func createOffer() { offerCount += 1 }
    func handleRemoteDescription(type: String, sdp: String) { remoteDescriptions.append((type, sdp)) }
    func handleRemoteCandidate(candidate: String, sdpMid: String?, sdpMLineIndex: Int32) { remoteCandidates.append(candidate) }
    func setLocalVideoSending(_ sending: Bool) { videoSendingCalls.append(sending) }
    func setCameraPosition(front: Bool) {}
    func setMicMuted(_ muted: Bool) { self.muted = muted }
    func setTorch(_ on: Bool) { torch = on }
    func setZoom(_ factor: Double) { zoom = factor }
    func stop() { stopCount += 1 }
    var onObserverLocalDescription: ((String, String, String) -> Void)?
    var onObserverLocalCandidate: ((String, String, String?, Int32) -> Void)?
    var onObserverRemoteVideoTrack: ((String) -> Void)?
    var observerPeers: [(id: String, offer: Bool)] = []
    func addObserverPeer(_ peerId: String, offer: Bool) { observerPeers.append((peerId, offer)) }
    func handleObserverDescription(from peerId: String, type: String, sdp: String) {}
    func handleObserverCandidate(from peerId: String, candidate: String, sdpMid: String?, sdpMLineIndex: Int32) {}
    func removeObserverPeer(_ peerId: String) {}
}

@MainActor
final class CallViewModelTests: XCTestCase {
    private var signaling: MockSignaling!
    private var media: MockMediaEngine!

    private func makeVM(role: CallViewModel.Role = .blind) -> CallViewModel {
        signaling = MockSignaling()
        media = MockMediaEngine()
        return CallViewModel(role: role, callId: "c1", signaling: signaling, media: media)
    }

    func testPeerJoinedResetsPrivacyGateAndConnects() {
        let vm = makeVM()
        vm.setVideoSending(true) // 模拟上一对端时已开画面
        XCTAssertEqual(signaling.videoGates, [true])

        vm.handle(["type": "peer-joined", "userId": "u2", "userName": "小明"])

        // 隐私默认关：新对端接入必须复位画面发送（审查 #4），绝不沿用旧状态。
        XCTAssertFalse(vm.videoSending)
        XCTAssertEqual(media.videoSendingCalls, [true, false])
        XCTAssertEqual(signaling.videoGates, [true, false])
        XCTAssertTrue(vm.connected)
        XCTAssertEqual(vm.peerName, "小明")
    }

    func testBlindHearsReconnectingOnIceDropAndRecovers() {
        // 盲人看不到"正在重连"横幅（协助者视频区有、盲人侧此前只 break）：ICE 掉线须告知盲人正在重连，
        // 否则声音中断会被误当对方挂断/沉默。恢复后声音自然回来即恢复信号。
        let lang = FeatureSettings().language
        let vm = makeVM(role: .blind)
        vm.handle(["type": "peer-joined", "userId": "u2", "userName": "妈妈"])
        XCTAssertTrue(vm.connected)
        vm.handleMediaState(.disconnected)
        XCTAssertEqual(vm.statusText, CallStrings.reconnecting(lang))
        vm.handleMediaState(.connected)                                   // ICE 恢复
        XCTAssertNotEqual(vm.statusText, CallStrings.reconnecting(lang))  // 不再停在"正在重连"
        vm.handleMediaState(.disconnected)                               // 再次掉线仍能再提示（非一次性）
        XCTAssertEqual(vm.statusText, CallStrings.reconnecting(lang))
    }

    func testMediaDropBeforeConnectDoesNotFalselyReportReconnecting() {
        // 未接通就收到 .disconnected（建立期抖动）→ guard(connected) 拦住，不误报"正在重连"。
        let lang = FeatureSettings().language
        let vm = makeVM(role: .blind)
        vm.handleMediaState(.disconnected)
        XCTAssertNotEqual(vm.statusText, CallStrings.reconnecting(lang))
    }

    func testBlindOffersExactlyOnceAcrossDuplicateJoins() {
        let vm = makeVM(role: .blind)
        vm.handle(["type": "joined", "peers": [["userId": "u2", "userName": "A"]]])
        vm.handle(["type": "peer-joined", "userId": "u2", "userName": "A"]) // 对端重连/重复消息
        XCTAssertEqual(media.offerCount, 1) // 防 glare（审查 #2）
    }

    func testHelperNeverOffers() {
        let vm = makeVM(role: .helper)
        vm.handle(["type": "joined", "peers": [["userId": "u1", "userName": "B"]]])
        XCTAssertTrue(vm.connected)
        XCTAssertEqual(media.offerCount, 0) // 只有发起方（盲人侧）发 offer
    }

    func testRemoteControlRequiresSharingVideo() {
        let vm = makeVM(role: .blind)
        vm.handle(["type": "control", "torch": true])
        XCTAssertNil(media.torch) // 未分享画面：拒绝远程控制（最小权限）

        vm.setVideoSending(true)
        vm.handle(["type": "control", "torch": true, "zoom": 2.0])
        XCTAssertEqual(media.torch, true)
        XCTAssertEqual(media.zoom, 2.0)
    }

    func testRemoteControlIgnoredOnHelperSide() {
        let vm = makeVM(role: .helper)
        vm.handle(["type": "control", "torch": true])
        XCTAssertNil(media.torch)
    }

    func testPeerEndStopsVideoAndClosesCall() {
        let vm = makeVM(role: .blind)
        vm.handle(["type": "peer-joined", "userId": "u2"])
        vm.setVideoSending(true)
        vm.handle(["type": "end"])
        XCTAssertTrue(vm.callEnded)
        XCTAssertFalse(vm.videoSending)           // 隐私复位
        XCTAssertEqual(media.videoSendingCalls.last, false)
        XCTAssertFalse(vm.connected)
    }

    func testOfferAnswerIceForwardedToMedia() {
        let vm = makeVM(role: .helper)
        vm.handle(["type": "offer", "sdp": "SDP_O"])
        vm.handle(["type": "answer", "sdp": "SDP_A"])
        vm.handle(["type": "ice", "candidate": "CAND", "sdpMLineIndex": 0])
        XCTAssertEqual(media.remoteDescriptions.map(\.type), ["offer", "answer"])
        XCTAssertEqual(media.remoteCandidates, ["CAND"])
    }

    func testHangUpIsIdempotent() {
        let vm = makeVM()
        vm.hangUp()
        vm.hangUp() // 按钮 + onDisappear + CallKit 可能重复触发
        XCTAssertEqual(signaling.endCount, 1)
        XCTAssertEqual(signaling.closeCount, 1)
        XCTAssertEqual(media.stopCount, 1)
    }

    func testObserverLeaveDoesNotEndParticipantsCall() {
        // 安全攸关：管理员旁观者「结束监看」/界面消失只应离场，绝不向参与者发 end 结束他人通话（见复审 LC-1）。
        let vm = makeVM(role: .adminObserver)
        vm.hangUp()
        XCTAssertEqual(signaling.endCount, 0)   // 不发 end
        XCTAssertEqual(media.stopCount, 1)      // 但本端媒体/信令照常释放
        XCTAssertEqual(signaling.closeCount, 1)
    }

    func testParticipantHangUpEndsCall() {
        // 对照：普通参与者挂断必须发 end，双方收线。
        let vm = makeVM(role: .blind)
        vm.hangUp()
        XCTAssertEqual(signaling.endCount, 1)
    }

    // MARK: 通话内实时文字（RTT）

    func testSendCallTextRequiresConnectionAndValidText() {
        let vm = makeVM(role: .blind)
        // 未接通：不发送
        XCTAssertFalse(vm.sendCallText("你好"))
        vm.handle(["type": "peer-joined", "userId": "u2"])
        // 空/纯空白：不发送
        XCTAssertFalse(vm.sendCallText("   "))
        // 超长（>500）：不发送（与服务端同口径，免得发出才被拒）
        XCTAssertFalse(vm.sendCallText(String(repeating: "x", count: 501)))
        // 长度按 UTF-16 码元计（服务端/web 都是 JS length 口径）：500 个 emoji = 1000 码元，必须拒发。
        // 字素簇计数（.count）会放行它、发出去才被服务端拒——三端口径必须一致。
        XCTAssertFalse(vm.sendCallText(String(repeating: "😀", count: 500)))
        // 正常：trim 后发出，气泡先落本地
        XCTAssertTrue(vm.sendCallText("  前面路口左转  "))
        XCTAssertEqual(vm.callTexts.count, 1)
        XCTAssertEqual(vm.callTexts[0].text, "前面路口左转")
        XCTAssertTrue(vm.callTexts[0].mine)
        let sentText = signaling.sent.first { ($0["type"] as? String) == "in-call-text" }
        XCTAssertEqual(sentText?["text"] as? String, "前面路口左转")
        XCTAssertNotNil(sentText?["id"]) // 带 id 供拒绝回执关联
        XCTAssertTrue(vm.sendCallText(String(repeating: "😀", count: 250))) // 500 码元临界放行
        XCTAssertEqual(vm.callTexts.count, 2)
    }

    func testIncomingCallTextAppendsAndCountsUnread() {
        let vm = makeVM(role: .blind)
        vm.handle(["type": "peer-joined", "userId": "u2"])
        vm.handle(["type": "in-call-text", "text": "我看到了红灯", "id": "p1", "from": "u2"])
        XCTAssertEqual(vm.callTexts.count, 1)
        XCTAssertFalse(vm.callTexts[0].mine)
        XCTAssertEqual(vm.unreadTexts, 1)          // 面板未开 → 计未读
        vm.setTextPanelOpen(true)
        XCTAssertEqual(vm.unreadTexts, 0)          // 打开面板清零
        vm.handle(["type": "in-call-text", "text": "现在是绿灯", "id": "p2"])
        XCTAssertEqual(vm.unreadTexts, 0)          // 面板开着不计未读
        // 空文本帧被忽略
        vm.handle(["type": "in-call-text", "text": ""])
        XCTAssertEqual(vm.callTexts.count, 2)
    }

    func testAdminObserverTextAttributedHonestly() {
        // 旁观管理员发的介入文字必须归属"管理员"，冒名"对方"是对盲人的说话人错误陈述（复审 MED）。
        let vm = makeVM(role: .blind)
        vm.handle(["type": "peer-joined", "userId": "u2", "userName": "协助者"])
        vm.handle(["type": "peer-joined", "userId": "adm1", "userName": "管理员甲", "role": "admin"])
        vm.handle(["type": "in-call-text", "text": "请注意安全", "from": "adm1"])
        vm.handle(["type": "in-call-text", "text": "我看到了", "from": "u2"])
        XCTAssertEqual(vm.callTexts.count, 2)
        XCTAssertTrue(vm.callTexts[0].fromAdmin)
        XCTAssertFalse(vm.callTexts[1].fromAdmin)
    }

    func testCallTextRejectionMarksBubble() {
        let vm = makeVM(role: .blind)
        vm.handle(["type": "peer-joined", "userId": "u2"])
        XCTAssertTrue(vm.sendCallText("hello"))
        let id = vm.callTexts[0].id
        vm.handle(["type": "in-call-text-rejected", "reason": "content_blocked", "id": id])
        XCTAssertEqual(vm.callTexts[0].failed, "content_blocked") // 气泡标记未发送，绝不静默丢失
        // 未知 id 的回执不崩、不误标
        vm.handle(["type": "in-call-text-rejected", "reason": "rate_limited", "id": "nonexistent"])
        XCTAssertEqual(vm.callTexts.filter { $0.failed != nil }.count, 1)
    }

    func testVideoGateStatusFollowsPeerState() {
        let vm = makeVM()
        vm.handle(["type": "peer-joined", "userId": "u2", "userName": "小明"])
        let lang = FeatureSettings().language
        vm.handle(["type": "video-gate", "on": true])
        XCTAssertEqual(vm.statusText, CallStrings.peerVideoOn(lang))
        vm.handle(["type": "video-gate", "on": false]) // 关画面回"已连接"，不卡在旧状态（审查 #3）
        XCTAssertEqual(vm.statusText, CallStrings.connectedWith("小明", lang))
    }
}
