import XCTest
@testable import BeeUrEiCore

/// 置信度门限：边界、NaN/∞ 防护。
final class ConfidencePolicyTests: XCTestCase {

    func testThresholdBoundary() {
        let p = ConfidencePolicy() // 默认 0.6
        XCTAssertTrue(p.isConfident(0.6))
        XCTAssertTrue(p.isConfident(0.95))
        XCTAssertFalse(p.isConfident(0.59))
        XCTAssertFalse(p.isConfident(0))
    }

    func testNonFiniteIsNeverConfident() {
        let p = ConfidencePolicy()
        XCTAssertFalse(p.isConfident(.nan))
        XCTAssertFalse(p.isConfident(.infinity))
    }

    func testCustomThreshold() {
        XCTAssertTrue(ConfidencePolicy(confidentThreshold: 0.3).isConfident(0.4))
    }
}
