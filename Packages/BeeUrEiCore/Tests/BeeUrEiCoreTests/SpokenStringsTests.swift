import XCTest
@testable import BeeUrEiCore

/// safeRoundedInt：防 `Int(非有限/巨值 Double)` 陷阱崩溃——App 层距离转 Int 的统一安全阀。
final class SpokenStringsTests: XCTestCase {
    func testSafeRoundedIntNormal() {
        XCTAssertEqual(SpokenStrings.safeRoundedInt(12.4), 12)
        XCTAssertEqual(SpokenStrings.safeRoundedInt(12.6), 13)
        XCTAssertEqual(SpokenStrings.safeRoundedInt(0), 0)
    }

    func testSafeRoundedIntNonFiniteAndNegative() {
        // 关键：Int(NaN/∞) 会陷阱崩溃——必须退化为 0，绝不崩。
        XCTAssertEqual(SpokenStrings.safeRoundedInt(.nan), 0)
        XCTAssertEqual(SpokenStrings.safeRoundedInt(.infinity), 0)
        XCTAssertEqual(SpokenStrings.safeRoundedInt(-.infinity), 0)
        XCTAssertEqual(SpokenStrings.safeRoundedInt(-5), 0) // 夹到非负
    }

    func testSafeRoundedIntHugeFiniteDoesNotOverflow() {
        // 关键：巨值有限 Double（如后端 distanceMeters=1e19 > Int.max）直接 Int() 会溢出崩溃——须夹到上界。
        XCTAssertEqual(SpokenStrings.safeRoundedInt(1e19), 1_000_000)
        XCTAssertEqual(SpokenStrings.safeRoundedInt(Double(Int.max)), 1_000_000) // 恰 Int.max 量级也夹住
        XCTAssertEqual(SpokenStrings.safeRoundedInt(999_999), 999_999)           // 上界内原值
    }

    /// locationDistance：位置尺度距离 <1km 用米、≥1km 用公里（0.1 精度去尾零）；完整单位词；溢出/非有限安全。
    func testLocationDistanceMetersUnderOneKm() {
        XCTAssertEqual(SpokenStrings.locationDistance(50, .zh), "50米")
        XCTAssertEqual(SpokenStrings.locationDistance(50, .en), "50 meters")
        XCTAssertEqual(SpokenStrings.locationDistance(999, .zh), "999米")   // 999m 仍米
        XCTAssertEqual(SpokenStrings.locationDistance(0, .zh), "0米")
    }

    func testLocationDistanceKilometersAtAndAboveOneKm() {
        XCTAssertEqual(SpokenStrings.locationDistance(1000, .zh), "1公里")      // 边界：整公里去尾零
        XCTAssertEqual(SpokenStrings.locationDistance(1000, .en), "1 kilometers")
        XCTAssertEqual(SpokenStrings.locationDistance(1500, .zh), "1.5公里")    // 0.1 精度
        XCTAssertEqual(SpokenStrings.locationDistance(2000, .en), "2 kilometers") // 去尾零 2.0→2
        XCTAssertEqual(SpokenStrings.locationDistance(1050, .zh), "1.1公里")    // 1050→10.5→四舍五入 11→1.1
    }

    func testLocationDistanceNonFiniteAndOverflowSafe() {
        XCTAssertEqual(SpokenStrings.locationDistance(.nan, .zh), "0米")        // 非有限→0米，不崩
        XCTAssertEqual(SpokenStrings.locationDistance(.infinity, .zh), "0米")   // ∞ 非有限→0米（safeRoundedInt 守卫）
        XCTAssertEqual(SpokenStrings.locationDistance(-5, .zh), "0米")          // 负→0
        XCTAssertEqual(SpokenStrings.locationDistance(1e19, .en), "1000 kilometers") // 巨值**有限**→夹 1e6 米=1000 公里
    }
}
