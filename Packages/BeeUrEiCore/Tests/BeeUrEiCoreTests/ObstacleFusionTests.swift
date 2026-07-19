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

    func testFovMateriallyChangesDirectionNearBoundary() {
        // 靠近"正前/右前"分界的障碍(x=0.71)：窄 FOV 68° 判 12 点(正前方)，广角机 77° 判 1 点(右前方)——
        // 差一档方位、盲人据此决定停还是绕。故障碍融合的 FOV 必须用**真实相机内参**而非硬编码
        //（见 HomeViewModel.fusionFOV/handle 修复）。此测锁住"FOV 确实改变方位"这一前提。
        let obj = DetectedObject(label: "柱子", normalizedX: 0.71, confidence: 0.8)
        let narrow = ObstacleFusion(horizontalFOVDegrees: 68).fuse(obj, distanceMeters: nil)
        let wide = ObstacleFusion(horizontalFOVDegrees: 77).fuse(obj, distanceMeters: nil)
        XCTAssertEqual(narrow.clock.hour, 12) // 68° → 正前方
        XCTAssertEqual(wide.clock.hour, 1)    // 77° → 右前方
        XCTAssertNotEqual(narrow.clock.hour, wide.clock.hour)
    }
}
