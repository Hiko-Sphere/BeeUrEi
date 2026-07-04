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
}
