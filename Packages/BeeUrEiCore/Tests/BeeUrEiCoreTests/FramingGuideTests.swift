import XCTest
@testable import BeeUrEiCore

final class FramingGuideTests: XCTestCase {
    let g = FramingGuide()

    func testSearchingWhenNoTarget() {
        XCTAssertEqual(g.guide(target: nil), .searching)
    }

    func testCenteredWhenCentralAndLarge() {
        XCTAssertEqual(g.guide(target: NormalizedBox(x: 0.3, y: 0.3, width: 0.4, height: 0.4)), .centered)
    }

    func testDirections() {
        XCTAssertEqual(g.guide(target: NormalizedBox(x: 0.0, y: 0.4, width: 0.2, height: 0.2)), .moveLeft)  // 目标在左
        XCTAssertEqual(g.guide(target: NormalizedBox(x: 0.8, y: 0.4, width: 0.2, height: 0.2)), .moveRight) // 目标在右
        XCTAssertEqual(g.guide(target: NormalizedBox(x: 0.4, y: 0.0, width: 0.2, height: 0.2)), .moveUp)    // 目标偏上
        XCTAssertEqual(g.guide(target: NormalizedBox(x: 0.4, y: 0.8, width: 0.2, height: 0.2)), .moveDown)  // 目标偏下
    }

    func testMoveCloserWhenCentralButSmall() {
        XCTAssertEqual(g.guide(target: NormalizedBox(x: 0.45, y: 0.45, width: 0.1, height: 0.1)), .moveCloser)
    }

    func testHintsNonEmpty() {
        for case let gd in [FramingGuidance.searching, .moveLeft, .moveRight, .moveUp, .moveDown, .moveCloser, .centered] {
            XCTAssertFalse(g.hint(gd).isEmpty)
        }
    }
}
