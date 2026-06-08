import XCTest
@testable import BeeUrEiCore

final class LightMeterTests: XCTestCase {
    let m = LightMeter()

    func testLevels() {
        XCTAssertEqual(m.level(brightness: 0.05), .dark)
        XCTAssertEqual(m.level(brightness: 0.2), .dim)
        XCTAssertEqual(m.level(brightness: 0.8), .ok)
    }

    func testWarnings() {
        XCTAssertNotNil(m.warning(brightness: 0.05))
        XCTAssertNotNil(m.warning(brightness: 0.2))
        XCTAssertNil(m.warning(brightness: 0.8))
    }

    func testLuminance() {
        XCTAssertEqual(LightMeter.luminance(r: 1, g: 1, b: 1), 1, accuracy: 0.001)
        XCTAssertEqual(LightMeter.luminance(r: 0, g: 0, b: 0), 0, accuracy: 0.001)
        XCTAssertEqual(LightMeter.luminance(r: 0, g: 1, b: 0), 0.587, accuracy: 0.001)
    }
}
