import XCTest
@testable import BeeUrEiCore

final class TrackingGateTests: XCTestCase {

    private let gate = TrackingGate()

    func testModes() {
        XCTAssertEqual(gate.mode(for: .normal), .ranging)
        XCTAssertEqual(gate.mode(for: .limited(reason: .excessiveMotion)), .relative)
        XCTAssertEqual(gate.mode(for: .notAvailable), .suspended)
    }

    func testAdvisories() {
        XCTAssertNil(gate.advisory(for: .normal))
        XCTAssertEqual(gate.advisory(for: .limited(reason: .excessiveMotion)), "跟踪不稳，请放慢移动")
        XCTAssertEqual(gate.advisory(for: .limited(reason: .insufficientFeatures)), "环境特征不足，测距精度下降")
        XCTAssertEqual(gate.advisory(for: .notAvailable), "无法测距，避障已降级")
    }
}
