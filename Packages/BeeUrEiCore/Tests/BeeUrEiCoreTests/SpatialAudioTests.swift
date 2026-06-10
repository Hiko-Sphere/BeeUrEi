import XCTest
@testable import BeeUrEiCore

/// AirPods 空间音核心逻辑单测：头部偏航参考系（标定/相对/漂移防护）+ 渲染算法选择策略。
/// 这些是「AirPods 空间音方向」可移植、可验证的纯逻辑部分；AVAudioEngine 渲染在 App 层真机验证。
final class SpatialAudioTests: XCTestCase {

    // MARK: HeadYawReference

    func testFirstSampleCalibratesToZero() {
        var ref = HeadYawReference()
        XCTAssertFalse(ref.isCalibrated)
        // 戴上耳机第一帧头朝 37°：锁为零位，相对偏航应为 0（用户没「转头」）。
        XCTAssertEqual(ref.relativeYaw(fromRawDegrees: 37), 0, accuracy: 1e-9)
        XCTAssertTrue(ref.isCalibrated)
    }

    func testRelativeYawAfterCalibration() {
        var ref = HeadYawReference()
        _ = ref.relativeYaw(fromRawDegrees: 10)        // 零位 = 10°
        XCTAssertEqual(ref.relativeYaw(fromRawDegrees: 40), 30, accuracy: 1e-9)   // 右转 30°
        XCTAssertEqual(ref.relativeYaw(fromRawDegrees: -20), -30, accuracy: 1e-9) // 左转 30°
    }

    func testWrapAroundAcrossPlusMinus180() {
        var ref = HeadYawReference()
        _ = ref.relativeYaw(fromRawDegrees: 170)       // 零位 = 170°
        // 原始跳到 -170°（即 190°），实际只右转了 20°，不应算成 -340°。
        XCTAssertEqual(ref.relativeYaw(fromRawDegrees: -170), 20, accuracy: 1e-9)
        // 原始 150°：相对零位左转 20°。
        XCTAssertEqual(ref.relativeYaw(fromRawDegrees: 150), -20, accuracy: 1e-9)
    }

    func testNonFiniteInputReturnsZeroAndDoesNotCalibrate() {
        var ref = HeadYawReference()
        XCTAssertEqual(ref.relativeYaw(fromRawDegrees: .nan), 0)
        XCTAssertEqual(ref.relativeYaw(fromRawDegrees: .infinity), 0)
        XCTAssertFalse(ref.isCalibrated, "坏值不得被锁成零位基线")
        // 之后第一个有效值才标定。
        XCTAssertEqual(ref.relativeYaw(fromRawDegrees: 90), 0, accuracy: 1e-9)
        XCTAssertTrue(ref.isCalibrated)
    }

    func testResetRecalibrates() {
        var ref = HeadYawReference()
        _ = ref.relativeYaw(fromRawDegrees: 0)         // 零位 = 0°
        XCTAssertEqual(ref.relativeYaw(fromRawDegrees: 45), 45, accuracy: 1e-9)
        ref.reset()
        XCTAssertFalse(ref.isCalibrated)
        // 重连后头朝 45°：重新锁为零位 → 相对 0（不再继承旧基线）。
        XCTAssertEqual(ref.relativeYaw(fromRawDegrees: 45), 0, accuracy: 1e-9)
    }

    func testRecenterSetsZero() {
        var ref = HeadYawReference()
        _ = ref.relativeYaw(fromRawDegrees: 0)
        ref.recenter(toRawDegrees: 90)                 // 「现在朝前」= 90°
        XCTAssertEqual(ref.relativeYaw(fromRawDegrees: 90), 0, accuracy: 1e-9)
        XCTAssertEqual(ref.relativeYaw(fromRawDegrees: 120), 30, accuracy: 1e-9)
        ref.recenter(toRawDegrees: .nan)               // 坏值忽略，零位不变
        XCTAssertEqual(ref.relativeYaw(fromRawDegrees: 90), 0, accuracy: 1e-9)
    }

    func testWrapEdgeCases() {
        XCTAssertEqual(HeadYawReference.wrap(180), 180, accuracy: 1e-9)
        XCTAssertEqual(HeadYawReference.wrap(-180), 180, accuracy: 1e-9)   // -180 归并到 180
        XCTAssertEqual(HeadYawReference.wrap(540), 180, accuracy: 1e-9)
        XCTAssertEqual(HeadYawReference.wrap(-540), 180, accuracy: 1e-9)
        XCTAssertEqual(HeadYawReference.wrap(270), -90, accuracy: 1e-9)
        XCTAssertEqual(HeadYawReference.wrap(0), 0, accuracy: 1e-9)
    }

    // MARK: SpatialAudioPolicy

    func testPicksHRTFHQWhenAvailable() {
        let algo = SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: [0, 1, 2, 6])
        XCTAssertEqual(algo, .hrtfHQ)
        XCTAssertTrue(SpatialAudioPolicy.isBinaural(algo))
    }

    func testFallsBackToHRTFWhenNoHQ() {
        XCTAssertEqual(SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: [0, 1, 2]), .hrtf)
    }

    func testFallsBackToSphericalHead() {
        XCTAssertEqual(SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: [0, 1]), .sphericalHead)
    }

    func testFallsBackToEqualPowerWhenNonePreferred() {
        // 仅有 soundField(3)/stereoPassThrough(5)/auto(7) 这些不适合点声源的算法 → 回退 equalPower。
        let algo = SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: [3, 5, 7])
        XCTAssertEqual(algo, .equalPowerPanning)
        XCTAssertFalse(SpatialAudioPolicy.isBinaural(algo))
    }

    func testEmptyAvailableFallsBackToEqualPower() {
        XCTAssertEqual(SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: []), .equalPowerPanning)
    }

    func testRawValuesAlignWithAVFoundation() {
        // 防回归：rawValue 必须与 AVAudio3DMixingRenderingAlgorithm 对齐，否则 App 映射会错配算法。
        XCTAssertEqual(SpatialRenderingAlgorithm.equalPowerPanning.rawValue, 0)
        XCTAssertEqual(SpatialRenderingAlgorithm.sphericalHead.rawValue, 1)
        XCTAssertEqual(SpatialRenderingAlgorithm.hrtf.rawValue, 2)
        XCTAssertEqual(SpatialRenderingAlgorithm.hrtfHQ.rawValue, 6)
        XCTAssertEqual(SpatialRenderingAlgorithm.auto.rawValue, 7)
    }
}
