import XCTest
@testable import BeeUrEiCore

/// 距离单位格式化（位置尺度）：换算系数错、边界错会让盲人对"多远"判断偏差（英里≈1609m 非 1000m）。
final class DistanceUnitTests: XCTestCase {

    func testMetricUnchangedFromLegacy() {
        // 公制与既有 locationDistance 口径一致（回归）：<1km 用米、≥1km 用公里去尾零。
        XCTAssertEqual(DistanceUnit.metric.farDistance(meters: 200, language: .zh), "200米")
        XCTAssertEqual(DistanceUnit.metric.farDistance(meters: 1500, language: .zh), "1.5公里")
        XCTAssertEqual(DistanceUnit.metric.farDistance(meters: 2000, language: .en), "2 kilometers") // 去尾零
        XCTAssertEqual(DistanceUnit.metric.farDistance(meters: 200, language: .en), "200 meters")
    }

    func testImperialFeetBelowThreshold() {
        // 100m ≈ 328 ft（100/0.3048）。< 1000ft → 英尺。
        XCTAssertEqual(DistanceUnit.imperial.farDistance(meters: 100, language: .en), "328 feet")
        XCTAssertEqual(DistanceUnit.imperial.farDistance(meters: 100, language: .zh), "328英尺")
        // 10m ≈ 33 ft。
        XCTAssertEqual(DistanceUnit.imperial.farDistance(meters: 10, language: .en), "33 feet")
    }

    func testImperialMilesAboveThreshold() {
        // 1 英里 = 1609.344 m → "1 mile"（去尾零 + 单数，非语病 "1 miles"）。
        XCTAssertEqual(DistanceUnit.imperial.farDistance(meters: 1609.344, language: .en), "1 mile")
        // 800m ≈ 2625 ft ≥ 1000 → 英里：800/1609.344≈0.497→0.5 英里。
        XCTAssertEqual(DistanceUnit.imperial.farDistance(meters: 800, language: .en), "0.5 miles")
        XCTAssertEqual(DistanceUnit.imperial.farDistance(meters: 3218.688, language: .zh), "2英里") // 正好 2 英里
    }

    /// 值为 1 用**单数**单位词（此前一律复数：1 meters / 1 kilometers / 1 miles 皆语病）。
    func testUnitSingularAtOne() {
        XCTAssertEqual(DistanceUnit.metric.farDistance(meters: 1, language: .en), "1 meter")     // 非 "1 meters"
        XCTAssertEqual(DistanceUnit.metric.farDistance(meters: 2, language: .en), "2 meters")     // 复数不变
        // 英尺侧：入参先取整到米，1 米≈3.28 英尺 → ft 恒 ∈{0,3,7,…}、永不为 1，无 "1 foot" 可达，恒 feet（复数正确）。
        XCTAssertEqual(DistanceUnit.imperial.farDistance(meters: 3, language: .en), "10 feet")     // 3m→~10ft
        // 边界 1km/1mile 单数已由 SpokenStringsTests / testImperialMilesAboveThreshold 覆盖。
    }

    func testImperialThresholdBoundary() {
        // 1000 ft = 304.8 m 恰界：< 1000ft 仍英尺；≥ 用英里。
        XCTAssertEqual(DistanceUnit.imperial.farDistance(meters: 304, language: .en), "997 feet")   // 997ft < 1000
        // 305m ≈ 1000.7 ft ≥ 1000 → 英里（305/1609.344≈0.19→0.2 英里）。
        XCTAssertEqual(DistanceUnit.imperial.farDistance(meters: 305, language: .en), "0.2 miles")
    }

    func testOverflowAndBadInputSafe() {
        // 非有限/负 → 0（safeRoundedInt 兜底），不崩、不产 NaN 文案。
        XCTAssertEqual(DistanceUnit.imperial.farDistance(meters: .nan, language: .en), "0 feet")
        XCTAssertEqual(DistanceUnit.imperial.farDistance(meters: -5, language: .en), "0 feet")
        XCTAssertEqual(DistanceUnit.metric.farDistance(meters: .infinity, language: .zh), "0米") // 非有限→0（safeRoundedInt 约定：坏读数当 0/未知，非最大值）
    }

    func testEnglishHasNoChinese() {
        for u in DistanceUnit.allCases {
            for m in [50.0, 5000.0] {
                let s = u.farDistance(meters: m, language: .en)
                XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), s)
            }
        }
    }
}
