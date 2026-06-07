import XCTest
@testable import BeeUrEiCore

final class ThermalPolicyTests: XCTestCase {

    private let policy = ThermalPolicy()

    func testNominalFullRate() {
        let p = policy.plan(for: .nominal)
        XCTAssertEqual(p.targetFPS, 15)
        XCTAssertFalse(p.stopCamera)
        XCTAssertNil(p.advisory)
    }

    func testSeriousDegrades() {
        let p = policy.plan(for: .serious)
        XCTAssertTrue(p.downscale)
        XCTAssertTrue(p.useNanoModel)
        XCTAssertFalse(p.stopCamera)
        XCTAssertNotNil(p.advisory)
    }

    func testCriticalStopsCamera() {
        let p = policy.plan(for: .critical)
        XCTAssertEqual(p.targetFPS, 0)
        XCTAssertTrue(p.stopCamera)
        XCTAssertNotNil(p.advisory)
    }

    func testThermalLevelOrdering() {
        XCTAssertTrue(ThermalLevel.nominal < .fair)
        XCTAssertTrue(ThermalLevel.serious < .critical)
    }
}
