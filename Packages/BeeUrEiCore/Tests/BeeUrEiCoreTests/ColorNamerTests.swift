import XCTest
@testable import BeeUrEiCore

final class ColorNamerTests: XCTestCase {
    let n = ColorNamer()

    func testPrimaries() {
        XCTAssertEqual(n.name(r: 1, g: 0, b: 0), "红色")
        XCTAssertEqual(n.name(r: 0, g: 1, b: 0), "绿色")
        XCTAssertEqual(n.name(r: 0, g: 0, b: 1), "蓝色")
        XCTAssertEqual(n.name(r: 1, g: 1, b: 0), "黄色")
    }

    func testNeutrals() {
        XCTAssertEqual(n.name(r: 1, g: 1, b: 1), "白色")
        XCTAssertEqual(n.name(r: 0, g: 0, b: 0), "黑色")
        XCTAssertEqual(n.name(r: 0.5, g: 0.5, b: 0.5), "灰色")
    }

    func testBrown() {
        // 暗橙 → 棕
        XCTAssertEqual(n.name(r: 0.5, g: 0.3, b: 0.1), "棕色")
    }
}
