import XCTest
@testable import BeeUrEiCore

/// 摔倒/撞击检测状态机：坠落三段式触发、车祸级冲击、日常活动绝不误报。
final class FallDetectorTests: XCTestCase {

    /// 以 20Hz 喂入一段模长序列，返回首个非 none 事件。
    private func run(_ samples: [Double], from t0: TimeInterval = 0) -> FallDetector.Event {
        var d = FallDetector()
        var t = t0
        for m in samples {
            let e = d.ingest(magnitude: m, at: t)
            if e != .none { return e }
            t += 0.05
        }
        return .none
    }

    func testFallPattern_freefallImpactStillness_triggers() {
        // 0.4s 失重 → 4g 撞击 → 2.6s 静止（≈1g）→ 报疑似摔倒。
        let freefall = Array(repeating: 0.1, count: 8)     // 0.4s @20Hz
        let impact = [4.0]
        let still = Array(repeating: 1.0, count: 54)       // 2.7s
        XCTAssertEqual(run(freefall + impact + still), .suspectedFall)
    }

    func testCrashLevelImpact_triggers() {
        // 无失重前奏的 7g 极端冲击 + 静止 → 报疑似车祸（车祸不一定有自由落体）。
        let normal = Array(repeating: 1.0, count: 10)
        let crash = [7.5]
        let still = Array(repeating: 1.05, count: 54)
        XCTAssertEqual(run(normal + crash + still), .suspectedCrash)
    }

    func testWalkingNeverTriggers() {
        // 步行模长在 0.6–1.6g 波动：不含失重不含高 g，绝不触发。
        let walking = (0..<200).map { 1.0 + 0.5 * sin(Double($0) * 0.6) }
        XCTAssertEqual(run(walking), .none)
    }

    func testImpactThenMovementDoesNotTrigger() {
        // 坠落+撞击后用户持续活动（捡起手机）：静止判定不过 → 不报，避免日常摔手机频繁误报。
        let freefall = Array(repeating: 0.1, count: 8)
        let impact = [4.0]
        let moving = (0..<54).map { 1.0 + (($0 % 2 == 0) ? 0.8 : -0.4) } // 大幅波动
        XCTAssertEqual(run(freefall + impact + moving), .none)
    }

    func testShortBlipNoImpact_resets() {
        // 短暂失重（0.1s，正常甩手）→ 回归正常：不触发。
        let blip = Array(repeating: 0.2, count: 2) + Array(repeating: 1.0, count: 60)
        XCTAssertEqual(run(blip), .none)
        // 足时失重但之后没有撞击（被接住）→ 不触发。
        let caught = Array(repeating: 0.1, count: 8) + Array(repeating: 1.0, count: 60)
        XCTAssertEqual(run(caught), .none)
    }

    func testNonFiniteInputIgnored() {
        var d = FallDetector()
        XCTAssertEqual(d.ingest(magnitude: .nan, at: 0), .none)
        XCTAssertEqual(d.ingest(magnitude: .infinity, at: 0.05), .none)
    }
}
