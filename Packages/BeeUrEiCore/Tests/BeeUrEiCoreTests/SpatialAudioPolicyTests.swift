import XCTest
@testable import BeeUrEiCore

/// 空间音策略回归网：导航信标双耳算法的择优/回退，以及"是否真双耳"判定。
/// 这层错了，盲人导航信标会退化成纯左右声像、听不出前后方位——属安全攸关。
final class SpatialAudioPolicyTests: XCTestCase {

    // MARK: bestBeaconAlgorithm —— 按 hrtfHQ > hrtf > sphericalHead > equalPowerPanning 择优

    func testPicksHighestAvailablePreference() {
        // 全可用 → 取最优 HRTFHQ
        XCTAssertEqual(SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: [0, 1, 2, 6]), .hrtfHQ)
        // 无 HRTFHQ → 取 HRTF
        XCTAssertEqual(SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: [0, 1, 2]), .hrtf)
        // 仅球面头模型 + 声像 → sphericalHead
        XCTAssertEqual(SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: [0, 1]), .sphericalHead)
        // 仅声像 → equalPowerPanning
        XCTAssertEqual(SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: [0]), .equalPowerPanning)
    }

    func testFallsBackToEqualPowerWhenNoPreferenceAvailable() {
        // 可用集合里没有任何偏好算法（soundField/stereoPassThrough/auto）→ 回退 equalPowerPanning，
        // 即使 0 不在可用集合里（注释保证：任何输出格式下声像都可用）。
        XCTAssertEqual(SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: [3, 5, 7]), .equalPowerPanning)
        XCTAssertEqual(SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: []), .equalPowerPanning)
    }

    func testPreferenceOrderIsStableRegardlessOfInputOrder() {
        // 输入顺序不影响择优（按偏好表而非输入顺序）。
        XCTAssertEqual(SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: [2, 6, 0, 1]), .hrtfHQ)
        XCTAssertEqual(SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: [1, 0, 2]), .hrtf)
    }

    // MARK: isBinaural —— 仅真 HRTF 系算双耳

    func testIsBinauralOnlyForHRTF() {
        XCTAssertTrue(SpatialAudioPolicy.isBinaural(.hrtf))
        XCTAssertTrue(SpatialAudioPolicy.isBinaural(.hrtfHQ))
        // 关键区分：sphericalHead 是头模型但非 HRTF 双耳；equalPowerPanning 只是左右声像。
        XCTAssertFalse(SpatialAudioPolicy.isBinaural(.sphericalHead))
        XCTAssertFalse(SpatialAudioPolicy.isBinaural(.equalPowerPanning))
        XCTAssertFalse(SpatialAudioPolicy.isBinaural(.soundField))
        XCTAssertFalse(SpatialAudioPolicy.isBinaural(.auto))
    }

    // 择优结果与 isBinaural 的联动：典型 AirPods 可用集应得到真双耳信标。
    func testTypicalAirPodsGetBinauralBeacon() {
        let chosen = SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: [0, 1, 2, 6])
        XCTAssertTrue(SpatialAudioPolicy.isBinaural(chosen), "AirPods 上应启用真双耳信标")
    }

    // rawValue 与 AVFoundation 对齐（4 被官方跳过，不应出现）。
    func testRawValuesAlignWithAVFoundation() {
        XCTAssertEqual(SpatialRenderingAlgorithm.equalPowerPanning.rawValue, 0)
        XCTAssertEqual(SpatialRenderingAlgorithm.hrtf.rawValue, 2)
        XCTAssertEqual(SpatialRenderingAlgorithm.hrtfHQ.rawValue, 6)
        XCTAssertNil(SpatialRenderingAlgorithm(rawValue: 4), "rawValue 4 被 AVFoundation 跳过")
    }
}
