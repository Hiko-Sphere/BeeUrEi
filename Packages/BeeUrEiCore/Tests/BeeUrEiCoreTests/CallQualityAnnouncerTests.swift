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
