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
    func connect(token: String, baseURL: URL) {}
    func join(callId: String, role: String) { joined.append((callId, role)) }
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
