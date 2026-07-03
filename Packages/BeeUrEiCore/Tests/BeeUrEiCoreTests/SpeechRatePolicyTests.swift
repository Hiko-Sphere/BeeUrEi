import XCTest
@testable import BeeUrEiCore

final class SpeechRatePolicyTests: XCTestCase {
    func testFasterSlowerStepAndClamp() {
        // 从默认 0.5 起：快一档 0.6、慢一档 0.4。
        XCTAssertEqual(SpeechRatePolicy.adjusted(from: 0.5, .faster), 0.6, accuracy: 0.0001)
        XCTAssertEqual(SpeechRatePolicy.adjusted(from: 0.5, .slower), 0.4, accuracy: 0.0001)
        // 夹到可懂区间上/下限，连说不越界。
        XCTAssertEqual(SpeechRatePolicy.adjusted(from: 0.7, .faster), 0.7, accuracy: 0.0001)
        XCTAssertEqual(SpeechRatePolicy.adjusted(from: 0.3, .slower), 0.3, accuracy: 0.0001)
        // normal 复位到 0.5，无论当前值。
        XCTAssertEqual(SpeechRatePolicy.adjusted(from: 0.9, .normal), 0.5, accuracy: 0.0001)
        XCTAssertEqual(SpeechRatePolicy.adjusted(from: 0.31, .normal), 0.5, accuracy: 0.0001)
    }

    func testNoFloatDriftAcrossManySteps() {
        // 反复快/慢不应因 Float 累加漂移出 0.1 档（否则边界判定与"已最快"提示失真）。
        var r: Float = 0.5
        for _ in 0..<10 { r = SpeechRatePolicy.adjusted(from: r, .faster) }
        XCTAssertEqual(r, 0.7, accuracy: 0.0001) // 封顶且对齐档位
        for _ in 0..<10 { r = SpeechRatePolicy.adjusted(from: r, .slower) }
        XCTAssertEqual(r, 0.3, accuracy: 0.0001)
    }

    func testAtLimit() {
        XCTAssertTrue(SpeechRatePolicy.atLimit(0.7, .faster))
        XCTAssertFalse(SpeechRatePolicy.atLimit(0.6, .faster))
        XCTAssertTrue(SpeechRatePolicy.atLimit(0.3, .slower))
        XCTAssertFalse(SpeechRatePolicy.atLimit(0.4, .slower))
        // 设置滑块停在区间外（0.9）→ 语音"再快点"视为已达上限（先夹进区间再判）。
        XCTAssertTrue(SpeechRatePolicy.atLimit(0.9, .faster))
        XCTAssertTrue(SpeechRatePolicy.atLimit(0.05, .slower))
        XCTAssertFalse(SpeechRatePolicy.atLimit(0.5, .normal))
    }
}
