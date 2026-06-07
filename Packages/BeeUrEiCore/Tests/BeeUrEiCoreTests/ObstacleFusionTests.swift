import XCTest
@testable import BeeUrEiCore

final class ObstacleFusionTests: XCTestCase {

    func testFuseProducesClockAndDistance() {
        let fusion = ObstacleFusion(horizontalFOVDegrees: 68)
        let obj = DetectedObject(label: "行人", normalizedX: 0.5, confidence: 0.9)
        let o = fusion.fuse(obj, distanceMeters: 1.2)

        XCTAssertEqual(o.label, "行人")
        XCTAssertEqual(o.clock.hour, 12)
        XCTAssertEqual(o.distanceMeters!, 1.2, accuracy: 0.0001)
        XCTAssertEqual(o.confidence, 0.9)
    }

    func testFuseRightSide() {
        let fusion = ObstacleFusion(horizontalFOVDegrees: 68)
        let o = fusion.fuse(DetectedObject(label: "柱子", normalizedX: 1.0, confidence: 0.7), distanceMeters: nil)
        XCTAssertEqual(o.clock.hour, 1)
        XCTAssertNil(o.distanceMeters)
    }
}
