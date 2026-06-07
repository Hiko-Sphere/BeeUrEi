import XCTest
@testable import BeeUrEiCore

final class LocationAccuracyGateTests: XCTestCase {

    private let gate = LocationAccuracyGate(preciseMaxMeters: 10, beaconMaxMeters: 20)

    func testLevels() {
        XCTAssertEqual(gate.level(horizontalAccuracyMeters: 5), .precise)
        XCTAssertEqual(gate.level(horizontalAccuracyMeters: 10), .precise)
        XCTAssertEqual(gate.level(horizontalAccuracyMeters: 15), .beacon)
        XCTAssertEqual(gate.level(horizontalAccuracyMeters: 20), .beacon)
        XCTAssertEqual(gate.level(horizontalAccuracyMeters: 40), .none)
    }

    func testInvalidAccuracyIsNone() {
        XCTAssertEqual(gate.level(horizontalAccuracyMeters: -1), .none)
    }

    func testHighCertaintyOnlyWhenPrecise() {
        XCTAssertTrue(gate.allowsHighCertaintyInstruction(horizontalAccuracyMeters: 8))
        XCTAssertFalse(gate.allowsHighCertaintyInstruction(horizontalAccuracyMeters: 15))
        XCTAssertFalse(gate.allowsHighCertaintyInstruction(horizontalAccuracyMeters: 65))
        XCTAssertFalse(gate.allowsHighCertaintyInstruction(horizontalAccuracyMeters: -1))
    }
}
