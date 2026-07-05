import XCTest
@testable import BeeUrEiCore

/// 周围的人概述：空/单人/多人、近→远排序、无距离排最后、同方位去重、中英。
final class PeopleSummarizerTests: XCTestCase {
    let s = PeopleSummarizer()

    func testEmpty() {
        XCTAssertEqual(s.summary(people: []), "没有看到人")
        XCTAssertEqual(s.summary(people: [], language: .en), "No people in view")
    }

    func testOnePersonWithDistance() {
        // x=0.5 → 12 点 → 正前方；1.5m → "1.5 米"
        XCTAssertEqual(s.summary(people: [(0.5, 1.5)]), "看到 1 个人：正前方，大约1.5 米")
    }

    func testOnePersonWithoutDistance() {
        // x=0.1 → -27.2° → 11 点 → 左前方
        XCTAssertEqual(s.summary(people: [(0.1, nil)]), "看到 1 个人：左前方")
    }

    func testManySortedByDistanceNilLast() {
        // 最近的是 2.0m 的正前方者；无距离者排最后；其他只报方位
        let text = s.summary(people: [(0.9, nil), (0.5, 2.0), (0.1, 3.5)])
        XCTAssertEqual(text, "看到 3 个人。最近的在正前方，大约2.0 米；其他在左前方、右前方")
    }

    func testOthersDirectionDeduped() {
        // 两个无距离者同在左前方 → 只报一次
        let text = s.summary(people: [(0.5, 1.0), (0.1, nil), (0.12, nil)])
        XCTAssertEqual(text, "看到 3 个人。最近的在正前方，大约1.0 米；其他在左前方")
    }

    func testOthersExcludeNearestDirection() {
        // 最近者在正前方；另一人也在正前方 → others 不应再报"正前方"(与最近者同方位，避免冗余含混)。
        let text = s.summary(people: [(0.5, 1.0), (0.52, nil), (0.9, nil)])
        XCTAssertEqual(text, "看到 3 个人。最近的在正前方，大约1.0 米；其他在右前方")
    }

    func testEnglish() {
        let text = s.summary(people: [(0.5, 1.5), (0.9, nil)], language: .en)
        XCTAssertEqual(text, "2 people. Nearest ahead, about 1.5 m; others ahead right")
    }

    /// 对抗复审 MEDIUM：坏距离(NaN/±inf/负/0)不得被当成有效距离、排成"最近的人"并念成贴身距离——净化为无距离。
    func testInvalidDistanceNotTreatedAsNearest() {
        // nan 距离的人被净化为无距离；真实 3m 的人才是最近，并报其真实距离（而非 nan 人被念成"0 米/很近"）。
        let zh = s.summary(people: [(0.5, 3.0), (0.9, Double.nan)])
        XCTAssertTrue(zh.contains("3.0"), "真实 3m 的人应为最近并报其距离；实际: \(zh)")
        XCTAssertFalse(zh.contains("很近"), "nan 人不得被当最近念成'很近'；实际: \(zh)")
        // 负距离 / +inf 同样净化：都无有效距离 → 绝不报出任何距离（不谎称"很近/0 米"）。
        let bad = s.summary(people: [(0.5, -1.0), (0.9, Double.infinity)])
        XCTAssertFalse(bad.contains("米"), "全为坏距离 → 不应报出任何距离; 实际: \(bad)")
    }

    /// 多人但**全无距离**（非 LiDAR 设备/读数缺失）：排序退化为横向序，绝不谎称某人"最近"——只报方位。
    func testManyWithoutDistanceDoesNotClaimNearest() {
        let zh = s.summary(people: [(0.1, nil), (0.5, nil), (0.9, nil)])
        XCTAssertFalse(zh.contains("最近的"), "无任何距离时不得称'最近的'（假精度）；实际: \(zh)")
        XCTAssertTrue(zh.hasPrefix("看到 3 个人。有人在"), "应改口'有人在<方位>'；实际: \(zh)")
        let en = s.summary(people: [(0.1, nil), (0.9, nil)], language: .en)
        XCTAssertFalse(en.contains("Nearest"), "no distance → never claim 'Nearest'; got: \(en)")
        XCTAssertTrue(en.hasPrefix("2 people. One "), "got: \(en)")
        // 有距离时仍如常称"最近的"（回归：修复不误伤正常路径）。
        XCTAssertTrue(s.summary(people: [(0.5, 2.0), (0.9, nil)]).contains("最近的在正前方，大约2.0 米"))
    }
}
