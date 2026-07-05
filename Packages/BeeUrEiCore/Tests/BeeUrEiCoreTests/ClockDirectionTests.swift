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

    // 回归：**巨大但有限**的输入（异常相机 FOV / 平滑毛刺）也不得崩溃——.isFinite 挡不住量级，
    // 修复前 Int(巨值) 会溢出陷阱致命崩溃。先对 360 取余后 hour 恒在合法 1...12。
    func testHugeFiniteFOVDoesNotCrash() {
        let d = ClockDirection(normalizedX: 1.0, horizontalFOVDegrees: 1e300)
        XCTAssertTrue((1...12).contains(d.hour))
    }

    func testHugeFiniteAngleDoesNotCrash() {
        let d = ClockDirection(angleDegrees: 1e300)
        XCTAssertTrue((1...12).contains(d.hour))
    }

    // 钟点周期性：360° 等价 0°(12 点)、390° 等价 30°(1 点)、-330° 等价 30°(1 点)。
    func testAngleIsPeriodicMod360() {
        XCTAssertEqual(ClockDirection(angleDegrees: 360).hour, 12)
        XCTAssertEqual(ClockDirection(angleDegrees: 390).hour, 1)
        XCTAssertEqual(ClockDirection(angleDegrees: -330).hour, 1)
    }

    // 平滑方位(init(angleDegrees:))覆盖整圈——normalizedX 受 FOV 限制只到 ±45°(1/2/10/11 点)，
    // 但平滑后的方位可指向正右/正后/正左。安全攸关：钟点方向说反=盲人朝相反方向去够物体/避障。
    // 尤其 ±180°(正后)都须归 6 点、+90°=正右=3 点、-90°=正左=9 点，此前这几个基点没被直接断言过。
    func testCardinalAnglesFullClock() {
        XCTAssertEqual(ClockDirection(angleDegrees: 90).hour, 3)    // 正右
        XCTAssertEqual(ClockDirection(angleDegrees: -90).hour, 9)   // 正左
        XCTAssertEqual(ClockDirection(angleDegrees: 180).hour, 6)   // 正后
        XCTAssertEqual(ClockDirection(angleDegrees: -180).hour, 6)  // 正后（负向对映也归 6）
        XCTAssertEqual(ClockDirection(angleDegrees: 60).hour, 2)
        XCTAssertEqual(ClockDirection(angleDegrees: -60).hour, 10)
        XCTAssertEqual(ClockDirection(angleDegrees: 120).hour, 4)
        XCTAssertEqual(ClockDirection(angleDegrees: -120).hour, 8)
        XCTAssertEqual(ClockDirection(angleDegrees: 150).hour, 5)
        XCTAssertEqual(ClockDirection(angleDegrees: -150).hour, 7)
    }
}
