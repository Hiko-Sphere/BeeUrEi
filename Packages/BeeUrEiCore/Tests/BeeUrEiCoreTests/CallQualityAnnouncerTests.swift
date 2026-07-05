import XCTest
@testable import BeeUrEiCore

/// 通话信号播报判定：只播"转弱"（带建议）与"从弱恢复"，防抖 + unknown 中性 + 不重复。
final class CallQualityAnnouncerTests: XCTestCase {

    func testWeakAnnouncedOnlyAfterSustainedConfirmations() {
        var a = CallQualityAnnouncer(confirmations: 3)
        XCTAssertNil(a.update(.weak, language: .zh))   // 1 次
        XCTAssertNil(a.update(.weak, language: .zh))   // 2 次
        let r = a.update(.weak, language: .zh)         // 3 次 → 播报
        XCTAssertNotNil(r); XCTAssertTrue(r!.contains("信号弱")); XCTAssertTrue(r!.contains("换个位置"))
        // 已播弱：持续弱不再重复。
        XCTAssertNil(a.update(.weak, language: .zh))
    }

    func testRecoveryAnnouncedAfterWeak() {
        var a = CallQualityAnnouncer(confirmations: 2)
        _ = a.update(.weak, language: .zh); _ = a.update(.weak, language: .zh) // 进入弱
        XCTAssertNil(a.update(.good, language: .zh))    // 恢复需确认
        let r = a.update(.fair, language: .zh)          // 第 2 次非弱 → 恢复
        XCTAssertNotNil(r); XCTAssertTrue(r!.contains("恢复"))
        XCTAssertNil(a.update(.good, language: .zh))    // 已恢复不重复
    }

    func testNoAnnounceForGoodFairAtStartOrBetween() {
        var a = CallQualityAnnouncer()
        XCTAssertNil(a.update(.good, language: .zh))    // 起步正常不播
        XCTAssertNil(a.update(.fair, language: .zh))    // fair↔good 不表态
        XCTAssertNil(a.update(.good, language: .zh))
        XCTAssertNil(a.update(.fair, language: .zh))
    }

    func testUnknownIsNeutralAndDoesNotBreakAccumulation() {
        var a = CallQualityAnnouncer(confirmations: 3)
        XCTAssertNil(a.update(.weak, language: .zh))     // 1
        XCTAssertNil(a.update(.unknown, language: .zh))  // 中性，不推进也不清零
        XCTAssertNil(a.update(.weak, language: .zh))     // 2
        XCTAssertNotNil(a.update(.weak, language: .zh))  // 3 → 播报（unknown 未打断）
    }

    func testFlickerResetsWeakAccumulation() {
        var a = CallQualityAnnouncer(confirmations: 3)
        XCTAssertNil(a.update(.weak, language: .zh))     // 1
        XCTAssertNil(a.update(.weak, language: .zh))     // 2
        XCTAssertNil(a.update(.good, language: .zh))     // 好信号打断 → 累积清零
        XCTAssertNil(a.update(.weak, language: .zh))     // 重新 1
        XCTAssertNil(a.update(.weak, language: .zh))     // 2
        XCTAssertNotNil(a.update(.weak, language: .zh))  // 3 → 现在才播
    }

    func testEnglishStrings() {
        var a = CallQualityAnnouncer(confirmations: 1)
        XCTAssertTrue(a.update(.weak, language: .en)!.contains("weak"))
        XCTAssertTrue(a.update(.good, language: .en)!.contains("normal"))
    }
}

/// 信号档的**RTT+丢包综合判定**（与协助端 web qualityFromStats 跨端一致）。
/// 关键不变量：低时延但高丢包**绝不**虚报 good——盲人靠通话音频听导航指引，丢包=断续听不清。
final class CallSignalLevelMetricsTests: XCTestCase {

    func testFromRttThresholdsAndBadInput() {
        XCTAssertEqual(CallSignalLevel.fromRtt(nil), .unknown)       // 无数据
        XCTAssertEqual(CallSignalLevel.fromRtt(0), .good)
        XCTAssertEqual(CallSignalLevel.fromRtt(0.149), .good)
        XCTAssertEqual(CallSignalLevel.fromRtt(0.15), .fair)
        XCTAssertEqual(CallSignalLevel.fromRtt(0.399), .fair)
        XCTAssertEqual(CallSignalLevel.fromRtt(0.4), .weak)
        XCTAssertEqual(CallSignalLevel.fromRtt(1.2), .weak)
        // 非有限保守当弱（不虚报好信号）——与 web NaN→weak 一致。
        XCTAssertEqual(CallSignalLevel.fromRtt(.nan), .weak)
        XCTAssertEqual(CallSignalLevel.fromRtt(.infinity), .weak)
    }

    func testFromLossThresholdsAndBadInput() {
        XCTAssertEqual(CallSignalLevel.fromLoss(nil), .unknown)      // 无数据不降级
        XCTAssertEqual(CallSignalLevel.fromLoss(.nan), .unknown)
        XCTAssertEqual(CallSignalLevel.fromLoss(0), .good)
        XCTAssertEqual(CallSignalLevel.fromLoss(0.029), .good)
        XCTAssertEqual(CallSignalLevel.fromLoss(0.03), .fair)
        XCTAssertEqual(CallSignalLevel.fromLoss(0.079), .fair)
        XCTAssertEqual(CallSignalLevel.fromLoss(0.08), .weak)
        XCTAssertEqual(CallSignalLevel.fromLoss(0.5), .weak)
        XCTAssertEqual(CallSignalLevel.fromLoss(-0.1), .good)        // 负值夹 0（计数器抖动不虚报差）
    }

    func testFromMetricsTakesWorseAndHandlesMissing() {
        XCTAssertEqual(CallSignalLevel.fromMetrics(rttSeconds: nil, lossFraction: nil), .unknown)
        // 关键：低时延(50ms)但 20% 丢包 → weak，不因 RTT 低虚报 good。
        XCTAssertEqual(CallSignalLevel.fromMetrics(rttSeconds: 0.05, lossFraction: 0.2), .weak)
        // 高时延零丢包 → weak（时延也拖累）。
        XCTAssertEqual(CallSignalLevel.fromMetrics(rttSeconds: 0.6, lossFraction: 0), .weak)
        // 皆好 → good；一好一 fair → 取更差 fair。
        XCTAssertEqual(CallSignalLevel.fromMetrics(rttSeconds: 0.05, lossFraction: 0.01), .good)
        XCTAssertEqual(CallSignalLevel.fromMetrics(rttSeconds: 0.05, lossFraction: 0.05), .fair)
        // 单信号缺失以另一为准（unknown 让位）。
        XCTAssertEqual(CallSignalLevel.fromMetrics(rttSeconds: 0.05, lossFraction: nil), .good)
        XCTAssertEqual(CallSignalLevel.fromMetrics(rttSeconds: nil, lossFraction: 0.2), .weak)
    }

    func testFromJitterThresholdsAndBadInput() {
        XCTAssertEqual(CallSignalLevel.fromJitter(nil), .unknown)
        XCTAssertEqual(CallSignalLevel.fromJitter(.nan), .unknown)
        XCTAssertEqual(CallSignalLevel.fromJitter(.infinity), .unknown)
        XCTAssertEqual(CallSignalLevel.fromJitter(0), .good)
        XCTAssertEqual(CallSignalLevel.fromJitter(0.029), .good)
        XCTAssertEqual(CallSignalLevel.fromJitter(0.03), .fair)
        XCTAssertEqual(CallSignalLevel.fromJitter(0.059), .fair)
        XCTAssertEqual(CallSignalLevel.fromJitter(0.06), .weak)
        XCTAssertEqual(CallSignalLevel.fromJitter(0.2), .weak)
        XCTAssertEqual(CallSignalLevel.fromJitter(-0.01), .good) // 负值夹 0
    }

    func testFromMetricsIncludesJitter() {
        // 关键：低时延低丢包但高抖动(100ms) → weak，不因前两者好虚报 good。
        XCTAssertEqual(CallSignalLevel.fromMetrics(rttSeconds: 0.05, lossFraction: 0.01, jitterSeconds: 0.1), .weak)
        // 三者皆好 → good。
        XCTAssertEqual(CallSignalLevel.fromMetrics(rttSeconds: 0.05, lossFraction: 0.01, jitterSeconds: 0.01), .good)
        // good+good+fair(jitter) → fair。
        XCTAssertEqual(CallSignalLevel.fromMetrics(rttSeconds: 0.05, lossFraction: 0.01, jitterSeconds: 0.04), .fair)
        // 只有抖动有数据（RTT/丢包缺）→ 以抖动为准。
        XCTAssertEqual(CallSignalLevel.fromMetrics(rttSeconds: nil, lossFraction: nil, jitterSeconds: 0.1), .weak)
        // 向后兼容：不传 jitterSeconds 时行为不变。
        XCTAssertEqual(CallSignalLevel.fromMetrics(rttSeconds: 0.05, lossFraction: 0.2), .weak)
    }
}
