import XCTest
@testable import BeeUrEiCore

final class GroundHazardDetectorTests: XCTestCase {
    let det = GroundHazardDetector()

    func testFlatGroundNoHazard() {
        // 平地：地面距离平滑递增（透视下增量变大但无突变）。
        XCTAssertEqual(det.detect(groundProfile: [1.0, 1.2, 1.45, 1.75, 2.1]), .none)
    }

    func testDropOffDetected() {
        // 1.2 → 2.0：跳变 0.8m 且 >1.4 倍 → 落差，距离取突变前的近点 1.2。
        XCTAssertEqual(det.detect(groundProfile: [1.0, 1.2, 2.0]), .dropOff(distanceMeters: 1.2))
    }

    func testRayMissIsDropOff() {
        // 射线打空（地面消失）→ 落差。
        XCTAssertEqual(det.detect(groundProfile: [1.0, 1.2, 1.4, -1, .nan]), .dropOff(distanceMeters: 1.4))
    }

    func testStepUpDetected() {
        // 地面突然变近 → 竖直面/台阶。
        XCTAssertEqual(det.detect(groundProfile: [1.5, 1.6, 1.1]), .stepUp(distanceMeters: 1.1))
    }

    func testTooFewSamples() {
        XCTAssertEqual(det.detect(groundProfile: [1.0, 5.0]), .none)
    }

    func testHints() {
        XCTAssertNotNil(det.hint(.dropOff(distanceMeters: 1.0)))
        XCTAssertNotNil(det.hint(.stepUp(distanceMeters: 0.4)))
        XCTAssertNil(det.hint(.none))
        XCTAssertTrue(det.hint(.dropOff(distanceMeters: 2.0))!.contains("落差"))
    }
}
