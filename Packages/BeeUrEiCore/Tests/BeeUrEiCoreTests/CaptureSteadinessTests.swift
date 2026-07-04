import XCTest
@testable import BeeUrEiCore

/// 拍摄稳定度：持续静达时长才判稳、抖动重新计时、间隙抖动不早判、坏样本保守。
final class CaptureSteadinessTests: XCTestCase {
    func testSteadyAfterHoldDuration() {
        var s = CaptureSteadiness(rotationThreshold: 0.12, holdDuration: 0.35)
        XCTAssertEqual(s.ingest(rotationRate: 0.05, at: 0.0), .settling) // 首个静帧只立基线
        XCTAssertEqual(s.ingest(rotationRate: 0.05, at: 0.2), .settling) // 0.2 < 0.35
        XCTAssertEqual(s.ingest(rotationRate: 0.05, at: 0.35), .steady)  // 达时长（含边界）
        XCTAssertEqual(s.ingest(rotationRate: 0.05, at: 0.5), .steady)   // 持续静仍稳
    }

    func testMovementBreaksSteady() {
        var s = CaptureSteadiness(holdDuration: 0.35)
        _ = s.ingest(rotationRate: 0.02, at: 0.0)
        XCTAssertEqual(s.ingest(rotationRate: 0.02, at: 0.4), .steady)
        XCTAssertEqual(s.ingest(rotationRate: 0.6, at: 0.5), .moving)     // 抖了
        XCTAssertEqual(s.ingest(rotationRate: 0.02, at: 0.6), .settling)  // 从 0.6 重新计时
        XCTAssertEqual(s.ingest(rotationRate: 0.02, at: 0.9), .settling)  // 0.9-0.6=0.3 < 0.35
        XCTAssertEqual(s.ingest(rotationRate: 0.02, at: 1.0), .steady)    // 1.0-0.6=0.4
    }

    func testBriefJitterMidSettleResetsTimer() {
        // 静→静→**一帧抖动**→静：不能把抖动前的静时长算进去而早判稳（否则拍下糊帧）。
        var s = CaptureSteadiness(holdDuration: 0.35)
        XCTAssertEqual(s.ingest(rotationRate: 0.03, at: 0.0), .settling)
        XCTAssertEqual(s.ingest(rotationRate: 0.03, at: 0.30), .settling)
        XCTAssertEqual(s.ingest(rotationRate: 0.50, at: 0.32), .moving)   // 瞬时抖动，计时清零
        XCTAssertEqual(s.ingest(rotationRate: 0.03, at: 0.34), .settling) // 从 0.34 重新起算
        XCTAssertEqual(s.ingest(rotationRate: 0.03, at: 0.50), .settling) // 0.16 < 0.35，仍未稳
        XCTAssertEqual(s.ingest(rotationRate: 0.03, at: 0.70), .steady)   // 0.36 ≥ 0.35
    }

    func testBadSamplesTreatedAsMoving() {
        var s = CaptureSteadiness(holdDuration: 0.30)
        _ = s.ingest(rotationRate: 0.02, at: 0.0)
        XCTAssertEqual(s.ingest(rotationRate: .nan, at: 0.2), .moving)     // 非有限
        XCTAssertEqual(s.ingest(rotationRate: -1.0, at: 0.3), .moving)     // 负模长（坏输入）
        XCTAssertEqual(s.ingest(rotationRate: 0.02, at: 0.4), .settling)   // 坏样本重置了计时
        XCTAssertEqual(s.ingest(rotationRate: 0.02, at: 0.75), .steady)    // 0.35 ≥ 0.30
    }

    func testResetRequiresReSettle() {
        var s = CaptureSteadiness(holdDuration: 0.30)
        _ = s.ingest(rotationRate: 0.02, at: 0.0)
        XCTAssertEqual(s.ingest(rotationRate: 0.02, at: 0.4), .steady)
        s.reset()                                                          // 拍完清零
        XCTAssertEqual(s.ingest(rotationRate: 0.02, at: 0.5), .settling)   // 须重新持稳
        XCTAssertEqual(s.ingest(rotationRate: 0.02, at: 0.85), .steady)
    }
}
