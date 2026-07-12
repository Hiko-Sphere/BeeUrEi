import XCTest
@testable import BeeUrEi

/// 共享位置「距离+方位」播报的单位（iter286）：盲人查看家人共享位置时听"约 200 米，在你的东北方向"。
/// 英语盲人对标 Soundscape 用英尺/英里思考——复用 DistanceUnit 单一换算源，与"我在哪"/导航同口径。
/// 不变量：① 公制默认逐字节不变（回归）；② 英制走 farDistance（<1000ft 英尺、≥ 英里），方位词原样保留。
final class LiveLocationDistanceUnitTests: XCTestCase {

    func testMetricIsDefaultAndUnchanged() {
        // 不传 unit → 公制；与历史输出一致。
        XCTAssertEqual(LiveLocationStrings.distanceBearing(meters: 200, bearing: "东北方向", .zh),
                       "约 200 米，在你的东北方向")
        XCTAssertEqual(LiveLocationStrings.distanceBearing(meters: 200, bearing: "north-east", .en),
                       "about 200 m to your north-east")
        // 默认值即显式 .metric。
        XCTAssertEqual(LiveLocationStrings.distanceBearing(meters: 200, bearing: "东北方向", .zh),
                       LiveLocationStrings.distanceBearing(meters: 200, bearing: "东北方向", unit: .metric, .zh))
    }

    func testImperialFeetAndMiles() {
        // 200m ≈ 656 ft（<1000ft → 英尺）；方位词保留。
        XCTAssertEqual(LiveLocationStrings.distanceBearing(meters: 200, bearing: "东北方向", unit: .imperial, .zh),
                       "约 656英尺，在你的东北方向")
        XCTAssertEqual(LiveLocationStrings.distanceBearing(meters: 200, bearing: "north-east", unit: .imperial, .en),
                       "about 656 feet to your north-east")
        // 2000m ≈ 1.2 mi（≥1000ft → 英里）。
        XCTAssertEqual(LiveLocationStrings.distanceBearing(meters: 2000, bearing: "north-east", unit: .imperial, .en),
                       "about 1.2 miles to your north-east")
    }

    func testImperialEnglishHasNoChinese() {
        let s = LiveLocationStrings.distanceBearing(meters: 500, bearing: "north-east", unit: .imperial, .en)
        XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), s)
    }
}
