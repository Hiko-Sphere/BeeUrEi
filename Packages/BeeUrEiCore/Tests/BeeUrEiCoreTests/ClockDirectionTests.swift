import XCTest
@testable import BeeUrEiCore

final class ClockDirectionTests: XCTestCase {

    func testCenterIsTwelve() {
        let d = ClockDirection(normalizedX: 0.5, horizontalFOVDegrees: 68)
        XCTAssertEqual(d.hour, 12)
        XCTAssertEqual(d.angleDegrees, 0, accuracy: 0.0001)
    }

    func testRightOfCenterIsPositiveAngle() {
        let d = ClockDirection(normalizedX: 1.0, horizontalFOVDegrees: 68)
        XCTAssertGreaterThan(d.angleDegrees, 0)
        XCTAssertEqual(d.hour, 1)   // +34° → 1 点钟
    }

    func testLeftOfCenterIsElevenOClock() {
        let d = ClockDirection(normalizedX: 0.0, horizontalFOVDegrees: 68)
        XCTAssertLessThan(d.angleDegrees, 0)
        XCTAssertEqual(d.hour, 11)  // -34° → 11 点钟
    }

    func testWideFOVRightEdgeIsTwoOClock() {
        // 90° FOV, x=1 → +45° → round(1.5)=2 → 2 点钟
        XCTAssertEqual(ClockDirection(normalizedX: 1.0, horizontalFOVDegrees: 90).hour, 2)
    }

    func testWideFOVLeftEdgeIsTenOClock() {
        XCTAssertEqual(ClockDirection(normalizedX: 0.0, horizontalFOVDegrees: 90).hour, 10)
    }

    func testClampsOutOfRangeInput() {
        let over = ClockDirection(normalizedX: 2.0, horizontalFOVDegrees: 68)
        let edge = ClockDirection(normalizedX: 1.0, horizontalFOVDegrees: 68)
        XCTAssertEqual(over.hour, edge.hour)
        XCTAssertEqual(over.angleDegrees, edge.angleDegrees, accuracy: 0.0001)
    }

    func testSpokenPhrase() {
        XCTAssertEqual(ClockDirection(normalizedX: 0.5, horizontalFOVDegrees: 68).spokenPhrase, "12 点钟方向")
    }

    // 回归：非有限输入不得崩溃，退化为「正前方/12 点」（修复前 Int(NaN) 会致命崩溃）。
    func testNaNInputDoesNotCrashAndFallsBackToTwelve() {
        let d = ClockDirection(normalizedX: .nan, horizontalFOVDegrees: 68)
        XCTAssertEqual(d.hour, 12)
        XCTAssertEqual(d.angleDegrees, 0, accuracy: 0.0001)
    }

    func testInfiniteFOVDoesNotCrash() {
        XCTAssertEqual(ClockDirection(normalizedX: 0.7, horizontalFOVDegrees: .infinity).hour, 12)
    }

    func testNaNFOVDoesNotCrash() {
        XCTAssertEqual(ClockDirection(normalizedX: 0.5, horizontalFOVDegrees: .nan).hour, 12)
    }
}
