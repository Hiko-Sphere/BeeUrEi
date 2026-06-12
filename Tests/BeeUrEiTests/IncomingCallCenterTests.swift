import XCTest
@testable import BeeUrEi

/// 来电中心状态机回归：铃响/接通互斥、去重、清理；铃声生命周期与超时收线门控。
@MainActor
final class IncomingCallCenterTests: XCTestCase {

    private final class MockRingtone: RingtonePlaying {
        var started = 0
        var stopped = 0
        func start() { started += 1 }
        func stop() { stopped += 1 }
    }

    private var tone: MockRingtone!

    override func setUp() async throws {
        tone = MockRingtone()
        IncomingCallCenter.shared.ringtone = tone // 注入静音 mock（默认实现会真响铃）
        IncomingCallCenter.shared.clear()
    }
    override func tearDown() async throws { IncomingCallCenter.shared.clear() }

    func testRingThenPresentAreMutuallyExclusive() {
        let c = IncomingCallCenter.shared
        c.ring(callId: "c1", callerName: "甲")
        XCTAssertTrue(c.hasIncoming)
        XCTAssertEqual(c.ringing?.callId, "c1")
        // 已有来电时，新的 present/ring 被去重忽略（防双弹）。
        c.present(callId: "c2", callerName: "乙")
        XCTAssertNil(c.pending)
        c.ring(callId: "c3", callerName: "丙")
        XCTAssertEqual(c.ringing?.callId, "c1")
    }

    func testClearResetsBoth() {
        let c = IncomingCallCenter.shared
        c.present(callId: "c9", callerName: "甲")
        XCTAssertNotNil(c.pending)
        c.clear()
        XCTAssertFalse(c.hasIncoming)
        // 清理后可再次接铃。
        c.ring(callId: "c10", callerName: "乙")
        XCTAssertEqual(c.ringing?.callId, "c10")
    }

    func testRingStartsToneAndClearStopsIt() {
        let c = IncomingCallCenter.shared
        c.ring(callId: "c1", callerName: "甲")
        XCTAssertEqual(tone.started, 1)
        c.clear()
        XCTAssertGreaterThanOrEqual(tone.stopped, 1) // 拒绝/对方取消（dismiss→clear）必须停铃
    }

    func testAnsweredRingingStopsToneButKeepsCallScreen() {
        let c = IncomingCallCenter.shared
        c.ring(callId: "c1", callerName: "甲")
        c.answeredRinging()
        XCTAssertGreaterThanOrEqual(tone.stopped, 1)     // 接听即停铃
        XCTAssertEqual(c.ringing?.callId, "c1")          // ringing 保留：驱动全屏内的通话界面
        // 接听后超时兜底不得收线（否则把进行中的通话界面关掉）。
        c.ringTimedOut(callId: "c1")
        XCTAssertEqual(c.ringing?.callId, "c1")
    }

    func testRingTimeoutClearsOnlyMatchingUnansweredCall() {
        let c = IncomingCallCenter.shared
        c.ring(callId: "c1", callerName: "甲")
        c.ringTimedOut(callId: "other") // 旧超时兜底落在新来电上：不收线
        XCTAssertEqual(c.ringing?.callId, "c1")
        c.ringTimedOut(callId: "c1")    // 本通超时未接：收线
        XCTAssertFalse(c.hasIncoming)
        XCTAssertGreaterThanOrEqual(tone.stopped, 1)
    }
}
