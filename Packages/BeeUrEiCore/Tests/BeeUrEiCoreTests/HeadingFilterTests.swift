import XCTest
@testable import BeeUrEiCore

final class HeadingFilterTests: XCTestCase {

    func testReliability() {
        let f = HeadingFilter(maxTrustedAccuracyDegrees: 20)
        XCTAssertTrue(f.isReliable(accuracyDegrees: 5))
        XCTAssertFalse(f.isReliable(accuracyDegrees: 25))
        XCTAssertFalse(f.isReliable(accuracyDegrees: -1))   // 无效/受干扰
    }

    func testFirstSampleSetsValue() {
        var f = HeadingFilter(smoothingFactor: 0.3)
        XCTAssertEqual(f.update(headingDegrees: 100, accuracyDegrees: 5), 100, accuracy: 0.0001)
    }

    func testSteadyHeadingStaysSteady() {
        var f = HeadingFilter(smoothingFactor: 0.5)
        _ = f.update(headingDegrees: 100, accuracyDegrees: 5)
        XCTAssertEqual(f.update(headingDegrees: 100, accuracyDegrees: 5), 100, accuracy: 0.0001)
    }

    func testWrapAroundSmoothing() {
        var f = HeadingFilter(smoothingFactor: 0.5)
        _ = f.update(headingDegrees: 350, accuracyDegrees: 5)
        let r = f.update(headingDegrees: 10, accuracyDegrees: 5)   // 350 与 10 的中点应在 0/360 附近
        let distTo0 = min(r, 360 - r)
        XCTAssertLessThan(distTo0, 1.0)
    }

    func testNormalizesInput() {
        var f = HeadingFilter(smoothingFactor: 0.5)
        XCTAssertEqual(f.update(headingDegrees: -90, accuracyDegrees: 5), 270, accuracy: 0.0001)
    }

    // 回归：不可信精度（负值=磁干扰/无效）的样本不得污染平滑航向。
    func testInvalidAccuracySampleDoesNotCorruptSmoothed() {
        var f = HeadingFilter(smoothingFactor: 0.5)
        _ = f.update(headingDegrees: 100, accuracyDegrees: 5)
        let r = f.update(headingDegrees: 280, accuracyDegrees: -1)   // 受干扰样本，应被忽略
        XCTAssertEqual(r, 100, accuracy: 1)
        XCTAssertEqual(f.current!, 100, accuracy: 1)
    }

    // 回归：首样本不可信时不播种平滑值，下一个可信样本才生效。
    func testUnreliableFirstSampleDoesNotSeed() {
        var f = HeadingFilter(smoothingFactor: 0.5)
        _ = f.update(headingDegrees: 200, accuracyDegrees: -1)
        XCTAssertNil(f.current)
        XCTAssertEqual(f.update(headingDegrees: 100, accuracyDegrees: 5), 100, accuracy: 0.0001)
    }
}
