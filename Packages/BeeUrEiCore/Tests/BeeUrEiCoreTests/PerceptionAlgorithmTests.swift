import XCTest
import simd
@testable import BeeUrEiCore

final class Geometry3DTests: XCTestCase {
    let k = CameraIntrinsics(fx: 500, fy: 500, cx: 320, cy: 240)

    func testProjectCenterAndOffset() {
        let id = matrix_identity_float4x4
        let p = PinholeCamera.project(SIMD3<Float>(0, 0, 2), cameraToWorld: id, intrinsics: k)!
        XCTAssertEqual(p.u, 320, accuracy: 0.01)
        XCTAssertEqual(p.v, 240, accuracy: 0.01)
        XCTAssertEqual(p.z, 2, accuracy: 0.01)
        let p2 = PinholeCamera.project(SIMD3<Float>(1, 0, 2), cameraToWorld: id, intrinsics: k)!
        XCTAssertEqual(p2.u, 570, accuracy: 0.01)
    }

    func testProjectBehindCameraIsNil() {
        XCTAssertNil(PinholeCamera.project(SIMD3<Float>(0, 0, -1), cameraToWorld: matrix_identity_float4x4, intrinsics: k))
    }

    func testUnprojectRoundTrip() {
        let w = PinholeCamera.unproject(u: 320, v: 240, depth: 2, cameraToWorld: matrix_identity_float4x4, intrinsics: k)
        XCTAssertEqual(w.x, 0, accuracy: 0.001)
        XCTAssertEqual(w.z, 2, accuracy: 0.001)
    }
}

final class CollisionCorridorTests: XCTestCase {
    func testContains() {
        let c = CollisionCorridor()
        let o = SIMD3<Float>(0, 0, 0), f = SIMD3<Float>(0, 0, 1), u = SIMD3<Float>(0, 1, 0)
        XCTAssertTrue(c.contains(SIMD3<Float>(0, 0.9, 1.5), origin: o, forward: f, up: u))
        XCTAssertFalse(c.contains(SIMD3<Float>(0.5, 0.9, 1.5), origin: o, forward: f, up: u)) // 侧方出界
        XCTAssertFalse(c.contains(SIMD3<Float>(0, 2.0, 1.5), origin: o, forward: f, up: u))   // 头顶上方
        XCTAssertFalse(c.contains(SIMD3<Float>(0, 0.9, 5), origin: o, forward: f, up: u))     // 超出纵深
    }

    func testAdaptiveDepth() {
        XCTAssertEqual(CollisionCorridor.adaptiveDepth(speed: 0), 1.5, accuracy: 0.01)
        XCTAssertEqual(CollisionCorridor.adaptiveDepth(speed: 2), 4, accuracy: 0.01)
        XCTAssertEqual(CollisionCorridor.adaptiveDepth(speed: 10), 6, accuracy: 0.01)
    }

    func testImageROIWithinBounds() {
        let c = CollisionCorridor()
        var m = matrix_identity_float4x4
        m.columns.3 = SIMD4<Float>(0, 1.4, -1, 1) // 相机在 (0,1.4,-1) 看 +Z
        let roi = c.imageROI(origin: SIMD3<Float>(0, 0, 0), forward: SIMD3<Float>(0, 0, 1), up: SIMD3<Float>(0, 1, 0),
                             cameraToWorld: m, intrinsics: CameraIntrinsics(fx: 500, fy: 500, cx: 320, cy: 240),
                             imageWidth: 640, imageHeight: 480)
        XCTAssertGreaterThan(roi.width, 0)
        XCTAssertGreaterThanOrEqual(roi.x, 0)
        XCTAssertLessThanOrEqual(roi.x + roi.width, 1.0001)
        XCTAssertLessThanOrEqual(roi.y + roi.height, 1.0001)
    }

    // 边界包含性：恰落在半宽/头高/纵深边界上的点算"在走廊内"（避免擦边障碍被漏判）。
    func testContainsBoundariesInclusive() {
        let c = CollisionCorridor()
        let o = SIMD3<Float>(0, 0, 0), f = SIMD3<Float>(0, 0, 1), u = SIMD3<Float>(0, 1, 0)
        XCTAssertTrue(c.contains(SIMD3<Float>(0.4, 1.0, 1.5), origin: o, forward: f, up: u)) // 半宽边界
        XCTAssertTrue(c.contains(SIMD3<Float>(0, 1.7, 1.5), origin: o, forward: f, up: u))   // 头高边界
        XCTAssertTrue(c.contains(SIMD3<Float>(0, 1.0, 3.0), origin: o, forward: f, up: u))   // 纵深边界
        XCTAssertFalse(c.contains(SIMD3<Float>(0, 0.04, 1.5), origin: o, forward: f, up: u)) // 低于 groundMin（贴地噪声）
        XCTAssertFalse(c.contains(SIMD3<Float>(0, 1.0, -0.1), origin: o, forward: f, up: u)) // 身后
    }

    // 走廊随前向旋转：前向转到 +X 后，纵深轴随之变为 X，判定坐标系一致旋转。
    func testContainsRotatedForward() {
        let c = CollisionCorridor()
        let o = SIMD3<Float>(0, 0, 0), fwdX = SIMD3<Float>(1, 0, 0), u = SIMD3<Float>(0, 1, 0)
        XCTAssertTrue(c.contains(SIMD3<Float>(1.5, 1.0, 0), origin: o, forward: fwdX, up: u))  // 沿新前向 1.5m 在内
        XCTAssertFalse(c.contains(SIMD3<Float>(0, 1.0, 1.5), origin: o, forward: fwdX, up: u)) // 旧前向方向已出界
    }

    // decel<=0 不得除零/产生 NaN：只保留 v·t 项再 clamp。
    func testAdaptiveDepthNonPositiveDecelIsSafe() {
        let d = CollisionCorridor.adaptiveDepth(speed: 2, reactionTime: 1, decel: 0)
        XCTAssertEqual(d, 2, accuracy: 0.01)
        XCTAssertFalse(d.isNaN)
    }

    // 安全不变量（见审查 #3）：任一角点落在相机后方/光心平面（投影失败）→ 保守回退整帧 .full，
    // 绝不可仅用剩余角点算出偏小且偏移的 ROI 而漏判近处障碍。
    func testImageROIFallsBackToFullWhenCornersBehindCamera() {
        let c = CollisionCorridor()
        // 相机在原点看 +Z，走廊原点也在相机处 → 近端（z=0，脚下）角点投影失败。
        let roi = c.imageROI(origin: SIMD3<Float>(0, 0, 0), forward: SIMD3<Float>(0, 0, 1), up: SIMD3<Float>(0, 1, 0),
                             cameraToWorld: matrix_identity_float4x4,
                             intrinsics: CameraIntrinsics(fx: 500, fy: 500, cx: 320, cy: 240),
                             imageWidth: 640, imageHeight: 480)
        XCTAssertEqual(roi, .full)
    }
}

final class AlphaBetaFilterTests: XCTestCase {
    func testConstantHasZeroVelocity() {
        var f = AlphaBetaFilter()
        for _ in 0..<10 { f.update(measurement: 5, dt: 0.5) }
        XCTAssertEqual(f.position, 5, accuracy: 0.01)
        XCTAssertEqual(f.velocity, 0, accuracy: 0.05)
    }

    func testRampEstimatesSlope() {
        var f = AlphaBetaFilter(alpha: 0.5, beta: 0.2)
        var x = 0.0
        for _ in 0..<20 { f.update(measurement: x, dt: 1); x += 1 } // 斜率 1/步
        XCTAssertEqual(f.velocity, 1, accuracy: 0.3)
    }

    // 回归：非有限 dt(坏帧时序)不得污染跟踪状态——否则 predicted=position+velocity*NaN=NaN，
    // position/velocity 永久为 NaN，障碍距离/闭合速度/TTC 全废。非有限 dt 当 0：仍并入观测。
    func testNonFiniteDtDoesNotPoison() {
        var f = AlphaBetaFilter(alpha: 0.5, beta: 0.2)
        f.update(measurement: 5, dt: 0.5)
        f.update(measurement: 6, dt: .nan)      // 坏 dt
        f.update(measurement: 6, dt: .infinity)  // 坏 dt
        XCTAssertTrue(f.position.isFinite)
        XCTAssertTrue(f.velocity.isFinite)
        XCTAssertEqual(f.position, 6, accuracy: 1.5) // 观测仍被并入（当 dt=0 平滑）
        f.update(measurement: 6, dt: 0.5)            // 后续正常 dt 仍收敛
        XCTAssertTrue(f.position.isFinite && f.velocity.isFinite)
    }
}

final class ObstacleTrackerTests: XCTestCase {
    private func obs(_ label: String, _ bearing: Double, _ dist: Double?) -> TrackObservation {
        TrackObservation(label: label, bearingDegrees: bearing, distanceMeters: dist)
    }

    func testConfirmsThenPersistsThroughMisses() {
        let t = ObstacleTracker(confirmHits: 2, maxMisses: 5)
        XCTAssertTrue(t.update([obs("person", 0, 2)], dt: 0.5).isEmpty)        // tentative
        let c1 = t.update([obs("person", 1, 1.9)], dt: 0.5)
        XCTAssertEqual(c1.count, 1)
        let id = c1[0].id
        _ = t.update([], dt: 0.5); _ = t.update([], dt: 0.5); _ = t.update([], dt: 0.5) // 3 漏检 < 5
        let c2 = t.update([obs("person", 2, 1.5)], dt: 0.5)
        XCTAssertEqual(c2.first?.id, id) // 同一 ID 续上
    }

    func testRemovedAfterMaxMisses() {
        let t = ObstacleTracker(confirmHits: 1, maxMisses: 3)
        _ = t.update([obs("person", 0, 2)], dt: 0.5)
        XCTAssertEqual(t.confirmedTracks.count, 1)
        for _ in 0..<4 { _ = t.update([], dt: 0.5) } // 4 > 3
        XCTAssertTrue(t.confirmedTracks.isEmpty)
    }

    func testTwoDistinctTracks() {
        let t = ObstacleTracker(confirmHits: 1)
        let r = t.update([obs("person", -30, 2), obs("car", 40, 3)], dt: 0.5)
        XCTAssertEqual(r.count, 2)
    }

    func testClosingSpeedAndTTC() {
        let t = ObstacleTracker(confirmHits: 1)
        _ = t.update([obs("person", 0, 5)], dt: 1)
        _ = t.update([obs("person", 0, 4)], dt: 1)
        _ = t.update([obs("person", 0, 3)], dt: 1)
        let track = t.confirmedTracks.first!
        XCTAssertGreaterThan(track.closingSpeed, 0)   // 正在靠近
        XCTAssertNotNil(track.timeToCollision)
    }
}

final class RiskAndTrafficTests: XCTestCase {
    func testTTC() {
        XCTAssertEqual(TimeToCollision.seconds(distanceMeters: 6, closingSpeed: 2)!, 3, accuracy: 0.001)
        XCTAssertNil(TimeToCollision.seconds(distanceMeters: 6, closingSpeed: 0)) // 不接近
    }

    func testRiskOrdering() {
        let r = RiskScore()
        let near = r.score(ttc: 2, distanceMeters: 1, bearingDegrees: 0, isHazard: true)
        let far = r.score(ttc: 10, distanceMeters: 8, bearingDegrees: 45, isHazard: false)
        XCTAssertGreaterThan(near, far)
    }

    func testTrafficLightClassify() {
        let c = TrafficLightClassifier()
        XCTAssertEqual(c.classify(r: 0.9, g: 0.1, b: 0.1), .red)
        XCTAssertEqual(c.classify(r: 0.1, g: 0.8, b: 0.2), .green)
        XCTAssertEqual(c.classify(r: 0.9, g: 0.7, b: 0.1), .yellow)
        XCTAssertEqual(c.classify(r: 0.05, g: 0.05, b: 0.05), .unknown) // 太暗
        XCTAssertEqual(c.classify(r: 0.5, g: 0.5, b: 0.5), .unknown)    // 灰
        XCTAssertNotNil(c.hint(.green))
        XCTAssertNil(c.hint(.unknown))
    }
}
