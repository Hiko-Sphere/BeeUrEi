import XCTest
@testable import BeeUrEiCore

/// 绕行侧建议：只在一侧**本身够空且明显更空**时推荐；拿不准静默。
/// 误报后果严重（把盲人引向有障碍的一侧），故边界从严测试。
final class ClearSideAdvisorTests: XCTestCase {
    private let advisor = ClearSideAdvisor() // clearThreshold=2.5, margin=1.2

    func testRecommendsClearlyOpenSide() {
        // 左 4m 空、右 0.8m 堵 → 左（本身 ≥2.5 且比右多 ≥1.2）。
        XCTAssertEqual(advisor.suggest(leftNearest: 4.0, rightNearest: 0.8), .left)
        XCTAssertEqual(advisor.suggest(leftNearest: 0.9, rightNearest: 3.5), .right)
    }

    func testStaysSilentWhenSuggestedSideNotIndependentlyClear() {
        // 右比左空，但右本身仅 1.8m < 2.5m 阈值 → 不推荐（那一侧本身不够走，只是"没左边那么堵"）。
        XCTAssertEqual(advisor.suggest(leftNearest: 0.5, rightNearest: 1.8), .none)
    }

    func testStaysSilentWhenSidesSimilar() {
        // 两侧都够空但差距 < margin（3.0 vs 3.5，差 0.5 < 1.2）→ 不指（别在都差不多时添噪）。
        XCTAssertEqual(advisor.suggest(leftNearest: 3.5, rightNearest: 3.0), .none)
        // 两侧都堵 → 不指（没有更好的选择）。
        XCTAssertEqual(advisor.suggest(leftNearest: 0.6, rightNearest: 0.7), .none)
    }

    func testNilAndBadReadingsNeverRecommended() {
        // 无读数（玻璃/超量程）绝不当"空"：一侧 nil、另一侧堵 → 不指（nil 侧不可信）。
        XCTAssertEqual(advisor.suggest(leftNearest: nil, rightNearest: 0.5), .none)
        // 另一侧 nil、本侧够空 → 推荐本侧（本侧独立够空，不依赖 nil 侧）。
        XCTAssertEqual(advisor.suggest(leftNearest: 3.0, rightNearest: nil), .left)
        // 坏值（NaN/负）视同不可信。
        XCTAssertEqual(advisor.suggest(leftNearest: .nan, rightNearest: 0.5), .none)
        XCTAssertEqual(advisor.suggest(leftNearest: -1, rightNearest: 4.0), .right)
        XCTAssertEqual(advisor.suggest(leftNearest: nil, rightNearest: nil), .none)
    }

    func testBoundaryExactlyAtThresholdAndMargin() {
        // 恰在阈值/余量边界：左=2.5（=阈值，含）、右=1.3（左比右多 1.2=margin，含）→ 左。
        XCTAssertEqual(advisor.suggest(leftNearest: 2.5, rightNearest: 1.3), .left)
        // 左=2.5、右=1.31（差 1.19 < margin）→ 不指。
        XCTAssertEqual(advisor.suggest(leftNearest: 2.5, rightNearest: 1.31), .none)
    }

    func testAwayFromObstacleGuardSuppressesContradiction() {
        // 障碍偏右(2 点钟, +60°)：只许荐左（背离障碍）；建议右＝往障碍侧走 → 抑制。
        XCTAssertEqual(advisor.awayFromObstacle(.left, obstacleBearingDegrees: 60), .left)
        XCTAssertEqual(advisor.awayFromObstacle(.right, obstacleBearingDegrees: 60), .none) // 矛盾抑制
        // 障碍偏左(10 点钟, -60°)：只许荐右。
        XCTAssertEqual(advisor.awayFromObstacle(.right, obstacleBearingDegrees: -60), .right)
        XCTAssertEqual(advisor.awayFromObstacle(.left, obstacleBearingDegrees: -60), .none)
    }

    func testAwayFromObstacleNearCenterUnrestricted() {
        // 障碍近正前方(|bearing| ≤ deadZone 8°)：两侧皆背离，不设限——原建议原样返回。
        XCTAssertEqual(advisor.awayFromObstacle(.left, obstacleBearingDegrees: 3), .left)
        XCTAssertEqual(advisor.awayFromObstacle(.right, obstacleBearingDegrees: -5), .right)
        XCTAssertEqual(advisor.awayFromObstacle(.right, obstacleBearingDegrees: 8), .right) // 恰在 deadZone 边界(含)
        // 坏 bearing 不额外设限（advisor 已保守）。
        XCTAssertEqual(advisor.awayFromObstacle(.left, obstacleBearingDegrees: .nan), .left)
        // .none 进 .none 出（无建议就没得护栏）。
        XCTAssertEqual(advisor.awayFromObstacle(.none, obstacleBearingDegrees: 60), .none)
    }

    func testHintSuffixBilingualAndSilentOnNone() {
        XCTAssertEqual(advisor.hintSuffix(.left, language: .zh), "，左侧较空")
        XCTAssertEqual(advisor.hintSuffix(.right, language: .zh), "，右侧较空")
        XCTAssertNil(advisor.hintSuffix(.none, language: .zh))
        for s in [advisor.hintSuffix(.left, language: .en)!, advisor.hintSuffix(.right, language: .en)!] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
        }
    }
}
