import XCTest
@testable import BeeUrEi

/// 导航播报距离单位（iter284）：turn-by-turn 剩余里程/全程概览/步骤列表的英制（英尺/英里）支持。
/// 英语盲人（对标 Soundscape/Apple/Google Maps 均念英尺/英里）此前只听到米/公里，每次都要心算换算。
/// 两条不变量：① 公制默认口径**逐字节不变**（不打扰现有用户，回归）；② 英制走 DistanceUnit.farDistance
/// （<1000ft 英尺、≥ 英里），且"快到了/Almost there"的近段语义（基于原始米）不受单位影响。
final class NavStringsDistanceUnitTests: XCTestCase {

    // MARK: 公制回归（默认单位 = 公制，且与历史输出一致）

    func testMetricIsDefaultAndUnchanged() {
        // 不传 unit → 公制；与显式 .metric 完全一致（默认值即历史行为）。
        XCTAssertEqual(NavStrings.remainingDistance(meters: 300, etaSeconds: nil, .zh),
                       NavStrings.remainingDistance(meters: 300, etaSeconds: nil, unit: .metric, .zh))
        // 历史口径：≥10m 取整到 10 米。
        XCTAssertEqual(NavStrings.remainingDistance(meters: 300, etaSeconds: nil, .zh), "还有约300 米")
        // <10m 报精确（末段临门一脚），且 ≤30m 加"快到了"。
        XCTAssertEqual(NavStrings.remainingDistance(meters: 5, etaSeconds: nil, .zh), "快到了，还有约5 米")
        // ≥1km 用公里一位小数。
        XCTAssertEqual(NavStrings.journeyOverview(meters: 1500, etaSeconds: nil, .en), "Route is about 1.5 km")
        XCTAssertEqual(NavStrings.stepListItem("右转", meters: 30, .zh), "右转（30 米）")
    }

    // MARK: 英制（英尺 / 英里）

    func testImperialFeetShortDistance() {
        // 100m ≈ 328 ft（< 1000ft → 英尺）；>30m 无"快到了"前缀；无 ETA。
        XCTAssertEqual(NavStrings.remainingDistance(meters: 100, etaSeconds: nil, unit: .imperial, .en),
                       "about 328 feet to go")
        XCTAssertEqual(NavStrings.remainingDistance(meters: 100, etaSeconds: nil, unit: .imperial, .zh),
                       "还有约328英尺")
    }

    func testImperialMilesLongDistance() {
        // 2000m ≈ 1.24 mi ≥ 1000ft → 英里；带 ETA 600s → ~10 min。
        XCTAssertEqual(NavStrings.journeyOverview(meters: 2000, etaSeconds: 600, unit: .imperial, .en),
                       "Route is about 1.2 miles, ~10 min")
    }

    func testImperialNearSegmentStillSaysAlmostThere() {
        // 近段语义基于**原始米**（≤30m），与单位无关：英制下 20m 仍须"快到了/Almost there"，距离用英尺。
        // 20m ≈ 66 ft。
        XCTAssertEqual(NavStrings.remainingDistance(meters: 20, etaSeconds: nil, unit: .imperial, .en),
                       "Almost there — about 66 feet to go")
        XCTAssertEqual(NavStrings.remainingDistance(meters: 20, etaSeconds: nil, unit: .imperial, .zh),
                       "快到了，还有约66英尺")
    }

    func testImperialStepListItem() {
        // 步骤列表也随单位：30m ≈ 98 ft。
        XCTAssertEqual(NavStrings.stepListItem("Turn right", meters: 30, unit: .imperial, .en),
                       "Turn right (98 feet)")
        XCTAssertEqual(NavStrings.stepListItem("右转", meters: 30, unit: .imperial, .zh),
                       "右转（98英尺）")
    }

    func testImperialEnglishHasNoChinese() {
        for m in [10, 200, 3000] {
            let s = NavStrings.remainingDistance(meters: m, etaSeconds: nil, unit: .imperial, .en)
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), s)
        }
    }
}
