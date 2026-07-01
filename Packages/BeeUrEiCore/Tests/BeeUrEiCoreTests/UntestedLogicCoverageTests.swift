import XCTest
import simd
@testable import BeeUrEiCore

/// 补齐三个此前无直接测试的纯逻辑模块的覆盖：ProximityCueMapper（距离→蜂鸣映射）、
/// SpeechGate/HintThrottle（语音仲裁 + 取景提示节流）、Geometry3D（相机 FOV / 针孔投影）。
/// 均为已人工核对正确的行为，测试用于锁定语义、防回归。
final class UntestedLogicCoverageTests: XCTestCase {

    // MARK: ProximityCueMapper（倒车雷达式距离提示）

    func testProximityCueNilOutsideRange() {
        let m = ProximityCueMapper(maxDistance: 4)
        XCTAssertNil(m.cue(distanceMeters: -0.1))    // 负距离
        XCTAssertNil(m.cue(distanceMeters: 4.1))     // 超上限
        XCTAssertNil(m.cue(distanceMeters: .nan))    // NaN（>=0 比较为假，被 guard 拦下）
        XCTAssertNil(m.cue(distanceMeters: .infinity))
    }

    func testProximityCueCloserMeansDenserAndHigher() {
        let m = ProximityCueMapper(maxDistance: 4, nearInterval: 0.1, farInterval: 1.0, nearPitch: 1200, farPitch: 600)
        let near = m.cue(distanceMeters: 0)
        let mid = m.cue(distanceMeters: 2)!
        let far = m.cue(distanceMeters: 4)
        XCTAssertEqual(near?.beepIntervalSeconds ?? -1, 0.1, accuracy: 1e-9)  // 最近=最密
        XCTAssertEqual(near?.pitchHz ?? -1, 1200, accuracy: 1e-9)            // 最近=最高
        XCTAssertEqual(far?.beepIntervalSeconds ?? -1, 1.0, accuracy: 1e-9)  // 最远=最疏
        XCTAssertEqual(far?.pitchHz ?? -1, 600, accuracy: 1e-9)
        XCTAssertLessThan(near!.beepIntervalSeconds, mid.beepIntervalSeconds) // 越近间隔越小
        XCTAssertLessThan(mid.beepIntervalSeconds, far!.beepIntervalSeconds)
        XCTAssertGreaterThan(near!.pitchHz, mid.pitchHz)                      // 越近音高越高
        XCTAssertGreaterThan(mid.pitchHz, far!.pitchHz)
    }

    // MARK: SpeechGate 语音总线仲裁

    func testSpeechGateIdlePlays() {
        XCTAssertEqual(SpeechGate.action(newChannel: .query, newDroppable: false, current: nil, safetyHold: false), .speakInterrupt)
    }

    func testSpeechGateSafetyHold() {
        XCTAssertEqual(SpeechGate.action(newChannel: .call, newDroppable: true, current: nil, safetyHold: true), .drop)    // 避障播报期间提示类丢弃
        XCTAssertEqual(SpeechGate.action(newChannel: .call, newDroppable: false, current: nil, safetyHold: true), .stash)  // 非提示积压待补播
    }

    func testSpeechGateHigherInterruptsLower() {
        XCTAssertEqual(SpeechGate.action(newChannel: .call, newDroppable: false, current: (.navigation, false), safetyHold: false), .speakInterrupt)
    }

    func testSpeechGateLowerYields() {
        XCTAssertEqual(SpeechGate.action(newChannel: .query, newDroppable: true, current: (.call, false), safetyHold: false), .drop)
        XCTAssertEqual(SpeechGate.action(newChannel: .query, newDroppable: false, current: (.call, false), safetyHold: false), .stash)
    }

    func testSpeechGateSameChannel() {
        XCTAssertEqual(SpeechGate.action(newChannel: .navigation, newDroppable: false, current: (.navigation, false), safetyHold: false), .speakEnqueue) // 导航排队顺读
        XCTAssertEqual(SpeechGate.action(newChannel: .query, newDroppable: true, current: (.query, false), safetyHold: false), .drop)                     // 取景提示不打断"这是X"
        XCTAssertEqual(SpeechGate.action(newChannel: .query, newDroppable: false, current: (.query, true), safetyHold: false), .speakInterrupt)           // 非提示替换提示
    }

    // MARK: HintThrottle 取景提示节流（防识别抖动砍语音）

    func testHintThrottleRequiresStabilityAndGap() {
        var h = HintThrottle(stableTicks: 2, minGap: 1.2, repeatGap: 2.5)
        XCTAssertFalse(h.shouldSpeak("向左", at: 0.0))  // 首帧不稳定
        XCTAssertTrue(h.shouldSpeak("向左", at: 1.3))   // 连续两帧一致且距上次≥minGap → 播
    }

    func testHintThrottleFlickerSuppressed() {
        var h = HintThrottle(stableTicks: 2, minGap: 0, repeatGap: 2.5)
        XCTAssertFalse(h.shouldSpeak("A", at: 0.0))     // A/B 交替永不达 stableTicks
        XCTAssertFalse(h.shouldSpeak("B", at: 0.1))
        XCTAssertFalse(h.shouldSpeak("A", at: 0.2))
        XCTAssertFalse(h.shouldSpeak("B", at: 0.3))
    }

    func testHintThrottleRepeatAfterRepeatGap() {
        var h = HintThrottle(stableTicks: 1, minGap: 0, repeatGap: 2.5)
        XCTAssertTrue(h.shouldSpeak("向右", at: 0.0))    // stableTicks=1 立即播
        XCTAssertFalse(h.shouldSpeak("向右", at: 1.0))   // 同提示未到 repeatGap
        XCTAssertTrue(h.shouldSpeak("向右", at: 2.6))    // 到 repeatGap 重播
    }

    func testHintThrottleNoteSpokeResets() {
        var h = HintThrottle(stableTicks: 2, minGap: 1.0, repeatGap: 2.5)
        _ = h.shouldSpeak("向左", at: 0.0)               // pending=1
        h.noteSpoke(at: 0.5)                             // 总线播了别的：重置 pending + lastSpoke=0.5
        XCTAssertFalse(h.shouldSpeak("向左", at: 0.6))   // 须重新积累
        XCTAssertTrue(h.shouldSpeak("向左", at: 1.6))    // 稳定2帧且 1.6-0.5≥1.0 → 播
    }

    // MARK: Geometry3D 相机 FOV / 针孔投影

    func testCameraFOVFormulaAndFallback() {
        XCTAssertEqual(CameraFOV.horizontalDegrees(fx: 500, imageWidth: 1000), 90, accuracy: 1e-6) // fx=w/2 → atan(1)=45° → FOV 90°
        XCTAssertEqual(CameraFOV.horizontalDegrees(fx: 0, imageWidth: 1000), 68, accuracy: 1e-9)   // 非法回退 68
        XCTAssertEqual(CameraFOV.horizontalDegrees(fx: .nan, imageWidth: 1000), 68, accuracy: 1e-9)
        XCTAssertEqual(CameraFOV.horizontalDegrees(fx: 500, imageWidth: -1), 68, accuracy: 1e-9)
    }

    func testPinholeProjectUnprojectRoundTrip() {
        let k = CameraIntrinsics(fx: 600, fy: 600, cx: 320, cy: 240)
        let world = SIMD3<Float>(0.5, -0.3, 2.0) // z>0，相机前方
        guard let p = PinholeCamera.project(world, cameraToWorld: matrix_identity_float4x4, intrinsics: k) else {
            return XCTFail("z>0 应投影成功")
        }
        let back = PinholeCamera.unproject(u: p.u, v: p.v, depth: p.z, cameraToWorld: matrix_identity_float4x4, intrinsics: k)
        XCTAssertEqual(back.x, world.x, accuracy: 1e-4)
        XCTAssertEqual(back.y, world.y, accuracy: 1e-4)
        XCTAssertEqual(back.z, world.z, accuracy: 1e-4)
    }

    func testPinholeProjectBehindCameraReturnsNil() {
        let k = CameraIntrinsics(fx: 600, fy: 600, cx: 320, cy: 240)
        XCTAssertNil(PinholeCamera.project(SIMD3<Float>(0, 0, -1), cameraToWorld: matrix_identity_float4x4, intrinsics: k)) // 相机后方
    }

    // MARK: FeedbackArbiter 反馈仲裁（iOS FeedbackCoordinator 的核心，决定 P0 避障是否抢占 P3 环境描述）

    func testFeedbackPriorityOrdering() {
        XCTAssertLessThan(FeedbackPriority.environment, FeedbackPriority.status)
        XCTAssertLessThan(FeedbackPriority.status, FeedbackPriority.turn)
        XCTAssertLessThan(FeedbackPriority.turn, FeedbackPriority.obstacle)
        XCTAssertLessThan(FeedbackPriority.obstacle, FeedbackPriority.critical)
    }

    func testFeedbackArbiterIdlePlays() {
        var a = FeedbackArbiter()
        XCTAssertTrue(a.shouldPlay(FeedbackEvent(priority: .environment, speech: "远处有树")))
        XCTAssertEqual(a.current?.priority, .environment)
    }

    func testFeedbackArbiterHigherPreempts() {
        var a = FeedbackArbiter()
        _ = a.shouldPlay(FeedbackEvent(priority: .environment, speech: "环境"))
        XCTAssertTrue(a.shouldPlay(FeedbackEvent(priority: .obstacle, speech: "障碍"))) // P0 抢占 P3
        XCTAssertEqual(a.current?.priority, .obstacle)
    }

    func testFeedbackArbiterLowerDropped() {
        var a = FeedbackArbiter()
        _ = a.shouldPlay(FeedbackEvent(priority: .critical, speech: "落差"))
        XCTAssertFalse(a.shouldPlay(FeedbackEvent(priority: .environment, speech: "环境"))) // 不打断最高优先级
        XCTAssertEqual(a.current?.priority, .critical) // current 保持
    }

    func testFeedbackArbiterEqualReplaces() {
        var a = FeedbackArbiter()
        _ = a.shouldPlay(FeedbackEvent(priority: .obstacle, speech: "5米"))
        XCTAssertTrue(a.shouldPlay(FeedbackEvent(priority: .obstacle, speech: "2米"))) // 同级：更近的覆盖
        XCTAssertEqual(a.current?.speech, "2米")
    }

    func testFeedbackArbiterFinishReleasesChannel() {
        var a = FeedbackArbiter()
        _ = a.shouldPlay(FeedbackEvent(priority: .critical, speech: "落差"))
        a.finish()
        XCTAssertNil(a.current)
        XCTAssertTrue(a.shouldPlay(FeedbackEvent(priority: .environment, speech: "环境"))) // 释放后低优先级可播
    }

    // MARK: Geo 大圆距离 / 方位角（导航基础，此前仅经 BreadcrumbTrail 等间接覆盖——直测绝对值防公式漂移）

    func testGeoDistanceKnownValues() {
        // 同点 → 0。
        XCTAssertEqual(Geo.distanceMeters(fromLat: 31.2, fromLon: 121.4, toLat: 31.2, toLon: 121.4), 0, accuracy: 1e-6)
        // 赤道 1° 经度 ≈ 111.2km（R=6371km）；1° 纬度同量级。绝对值锁死，防半径/因子写错。
        XCTAssertEqual(Geo.distanceMeters(fromLat: 0, fromLon: 0, toLat: 0, toLon: 1), 111_195, accuracy: 300)
        XCTAssertEqual(Geo.distanceMeters(fromLat: 0, fromLon: 0, toLat: 1, toLon: 0), 111_195, accuracy: 300)
    }

    func testGeoInitialBearingCardinals() {
        XCTAssertEqual(Geo.initialBearing(fromLat: 0, fromLon: 0, toLat: 1, toLon: 0), 0, accuracy: 0.5)    // 正北
        XCTAssertEqual(Geo.initialBearing(fromLat: 0, fromLon: 0, toLat: 0, toLon: 1), 90, accuracy: 0.5)   // 正东
        XCTAssertEqual(Geo.initialBearing(fromLat: 0, fromLon: 0, toLat: -1, toLon: 0), 180, accuracy: 0.5) // 正南
        XCTAssertEqual(Geo.initialBearing(fromLat: 0, fromLon: 0, toLat: 0, toLon: -1), 270, accuracy: 0.5) // 正西
    }
}
