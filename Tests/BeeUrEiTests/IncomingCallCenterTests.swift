import XCTest
@testable import BeeUrEi

/// 来电中心状态机回归：铃响/接通互斥、去重、清理。
@MainActor
final class IncomingCallCenterTests: XCTestCase {

    override func setUp() async throws { IncomingCallCenter.shared.clear() }
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
}
