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

    // 回归：坏亮度读数（NaN/∞）保守判「暗」，绝不谎报"光线充足"（.ok 会让 warning 静默、description 报"充足"）。
    func testNonFiniteBrightnessFailsSafeToDark() {
        for bad in [Double.nan, .infinity, -.infinity] {
            XCTAssertEqual(m.level(brightness: bad), .dark, "非有限亮度应保守判暗，不落 .ok")
            XCTAssertNotNil(m.warning(brightness: bad), "坏读数须提醒（到亮处重试），不能静默")
            // 光线探测播报也不得出现"充足"（会误导盲人以为能扫）。
            XCTAssertFalse(m.description(brightness: bad, brighterSide: .even, language: .zh).contains("充足"))
            XCTAssertFalse(m.description(brightness: bad, brighterSide: .even, language: .en).lowercased().contains("good"))
        }
    }

    func testLuminance() {
        XCTAssertEqual(LightMeter.luminance(r: 1, g: 1, b: 1), 1, accuracy: 0.001)
        XCTAssertEqual(LightMeter.luminance(r: 0, g: 0, b: 0), 0, accuracy: 0.001)
        XCTAssertEqual(LightMeter.luminance(r: 0, g: 1, b: 0), 0.587, accuracy: 0.001)
    }
}
