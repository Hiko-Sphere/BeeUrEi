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

    func testEnglish() {
        let text = s.summary(people: [(0.5, 1.5), (0.9, nil)], language: .en)
        XCTAssertEqual(text, "2 people. Nearest ahead, about 1.5 m; others ahead right")
    }
}
