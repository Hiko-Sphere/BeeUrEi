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

    // 回归：坏检测框（任一坐标 NaN/∞）绝不谎报 .centered（"对准了、可以拍"），视作没检到目标 → .searching。
    func testNonFiniteBoxNotReportedCentered() {
        for bad in [Double.nan, .infinity, -.infinity] {
            XCTAssertEqual(g.guide(target: NormalizedBox(x: bad, y: 0.4, width: 0.4, height: 0.4)), .searching)
            XCTAssertEqual(g.guide(target: NormalizedBox(x: 0.3, y: 0.3, width: bad, height: 0.4)), .searching)
            XCTAssertEqual(g.guide(target: NormalizedBox(x: 0.3, y: bad, width: 0.4, height: 0.4)), .searching)
        }
    }
}
