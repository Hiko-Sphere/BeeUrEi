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

    func testCoarseSampling_freefallEndsIntoDeceleration_thenImpact_triggers() {
        // 边界采样漏报修复：失重在"恰跨过 0.25s 时长阈值"的同一采样里结束（|a| 升到减速档 1.5g、尚未到撞击尖峰），
        // 紧随一采样才出现 4g 撞击尖峰 → 应报疑似摔倒。修复前会在减速档误 idle、漏掉紧随的撞击（假阴性）。
        let freefall = Array(repeating: 0.1, count: 5)   // t=0..0.20 <0.35
        let ended = [1.5]                                 // t=0.25：失重结束、减速中（未到 2.8）
        let impact = [4.0]                                // t=0.30：撞击尖峰
        let still = Array(repeating: 1.0, count: 54)
        XCTAssertEqual(run(freefall + ended + impact + still), .suspectedFall)
    }

    func testLongFreefall_impactAtEnd_triggers() {
        // 长时间坠落（如坠入楼梯井/站台/阳台）末尾撞击 → 应报（正是本功能存在意义的高后果事件）。
        // 修复前撞击窗从坠落**中途**（跨过 0.25s 时长阈值那刻，deadline=0.25+1.2=1.45s）起算：坠落续到 t=1.50 时
        // 该窗在半空中超时→idle，紧随 t=1.55 的落地撞击落进 idle 被丢弃＝漏报（复审 Issue#1）。撞击窗须从落地那刻起算。
        let freefall = Array(repeating: 0.1, count: 31)  // t=0..1.50 持续失重（跨过旧 deadline 1.45）
        let impact = [4.0]                                // t=1.55 落地撞击
        let still = Array(repeating: 1.0, count: 54)
        XCTAssertEqual(run(freefall + impact + still), .suspectedFall)
    }

    func testFreefallEndsIntoDeceleration_butNoImpact_doesNotTrigger() {
        // 上述路径的假阳性守卫：失重结束进入减速档后，若始终无 >2.8g 撞击（被稳稳接住/轻放）→ 绝不触发。
        let freefall = Array(repeating: 0.1, count: 5)
        let ended = [1.2]                                 // 减速档，进入 awaitingImpact
        let calm = Array(repeating: 1.0, count: 60)       // 之后无撞击 → 等待窗超时 → 复位
        XCTAssertEqual(run(freefall + ended + calm), .none)
    }

    func testNonFiniteInputIgnored() {
        var d = FallDetector()
        XCTAssertEqual(d.ingest(magnitude: .nan, at: 0), .none)
        XCTAssertEqual(d.ingest(magnitude: .infinity, at: 0.05), .none)
    }
}
