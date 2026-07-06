import XCTest
@testable import BeeUrEiCore

/// 低电量主动告警去抖：跌破 20%/10%/5% 各播一次、不因 1% 抖动连播、充电不打扰、回升后可再播、未知不播。
final class LowBatteryWarnerTests: XCTestCase {
    func testWarnsOncePerThresholdCrossing() {
        var w = LowBatteryWarner()
        XCTAssertNil(w.update(percent: 50, charging: false))   // 正常：不播
        XCTAssertNil(w.update(percent: 21, charging: false))   // 21%：还没跌破
        XCTAssertEqual(w.update(percent: 20, charging: false), .low)   // 跌破 20% → 提醒
        XCTAssertNil(w.update(percent: 19, charging: false))   // 19%：同档不重播
        XCTAssertNil(w.update(percent: 15, charging: false))   // 15%：仍在 low 档，已播过
        XCTAssertEqual(w.update(percent: 10, charging: false), .critical) // 跌破 10% → 紧急
        XCTAssertNil(w.update(percent: 9, charging: false))    // 9%：紧急档已播
        XCTAssertNil(w.update(percent: 6, charging: false))    // 6%：仍未到 5% 濒断电档
        XCTAssertEqual(w.update(percent: 5, charging: false), .critical) // 跌破 5% → 濒临关机再紧急一次
        XCTAssertNil(w.update(percent: 4, charging: false))    // 4%：5% 档已播，不重播
    }

    func testReWarnsNearShutdownEvenAfterCriticalFired() {
        // 濒临关机再提醒（生命线设备）：10% 那次可能被安全播报打断/用户在通话中错过，5% 前须再播一次。
        var w = LowBatteryWarner()
        XCTAssertEqual(w.update(percent: 10, charging: false), .critical)
        XCTAssertNil(w.update(percent: 8, charging: false))              // 8%：10% 档已播、未到 5%
        XCTAssertEqual(w.update(percent: 5, charging: false), .critical) // 濒断电 → 再播
        XCTAssertNil(w.update(percent: 3, charging: false))             // 已播，不重播
        // 充电回升 → 重新武装；再次跌破 5% 可再播。
        XCTAssertNil(w.update(percent: 60, charging: true))
        XCTAssertEqual(w.update(percent: 5, charging: false), .critical)
    }

    func testDirectJumpToEmptySkipsHigherTiers() {
        // 后台良久后一次直接读到 3%（跳过 20%/10% 读数）：直接濒断电只紧急一次，不补播 low/critical 刷屏。
        var w = LowBatteryWarner()
        XCTAssertEqual(w.update(percent: 3, charging: false), .critical)
        XCTAssertNil(w.update(percent: 2, charging: false))
    }

    func testChargingReArmsAndSilences() {
        var w = LowBatteryWarner()
        XCTAssertEqual(w.update(percent: 18, charging: false), .low)
        XCTAssertNil(w.update(percent: 18, charging: true))    // 充电中不打扰
        XCTAssertNil(w.update(percent: 30, charging: true))
        // 拔充后仍低 → 重新武装，可再播。
        XCTAssertEqual(w.update(percent: 18, charging: false), .low)
    }

    func testRecoveryReArms() {
        var w = LowBatteryWarner()
        XCTAssertEqual(w.update(percent: 20, charging: false), .low)
        XCTAssertNil(w.update(percent: 20, charging: false))   // 已播
        XCTAssertNil(w.update(percent: 25, charging: false))   // 回升到档位之上（抖动/换电池）
        XCTAssertEqual(w.update(percent: 20, charging: false), .low) // 再次跌破 → 可再播
    }

    func testDirectJumpToCriticalSkipsLow() {
        var w = LowBatteryWarner()
        // 后台良久后一次读到 8%（跳过 20% 读数）：直接紧急，不补播 low。
        XCTAssertEqual(w.update(percent: 8, charging: false), .critical)
        XCTAssertNil(w.update(percent: 8, charging: false))
    }

    func testUnknownLevelNeverWarns() {
        var w = LowBatteryWarner()
        XCTAssertNil(w.update(percent: -1, charging: false))   // 模拟器/未知：不猜不播
        XCTAssertEqual(w.update(percent: 10, charging: false), .critical)
    }
}
