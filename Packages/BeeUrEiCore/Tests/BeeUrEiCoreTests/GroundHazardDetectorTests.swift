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

    func testRayMissAloneIsNotDropOff() {
        // 仅射线打空(未知/低置信)不再误报落差——LiDAR 在深色/湿滑地面常读不到（见审查 #7）。
        XCTAssertEqual(det.detect(groundProfile: [1.0, 1.2, 1.4, -1, .nan]), .none)
        // 开头打空后地面正常：跳过未知样本，平滑递增 → 无危险（见审查 #5/#7 折中）。
        XCTAssertEqual(det.detect(groundProfile: [.nan, 1.0, 1.1, 1.2, 1.3]), .none)
    }

    func testDropOffViaDiscontinuityIgnoresMisses() {
        // 未知样本被跳过；可靠样本间真实不连续(1.2→2.5)仍判落差。
        XCTAssertEqual(det.detect(groundProfile: [1.0, 1.2, -1, 2.5, 2.6]), .dropOff(distanceMeters: 1.2))
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
