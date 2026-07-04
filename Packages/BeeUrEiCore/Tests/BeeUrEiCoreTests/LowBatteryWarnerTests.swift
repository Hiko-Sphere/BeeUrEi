import XCTest
@testable import BeeUrEiCore

/// 低电量主动告警去抖：跌破 20%/10% 各播一次、不因 1% 抖动连播、充电不打扰、回升后可再播、未知不播。
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
        XCTAssertNil(w.update(percent: 5, charging: false))
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
