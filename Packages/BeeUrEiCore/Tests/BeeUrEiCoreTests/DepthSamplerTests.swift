import XCTest
@testable import BeeUrEiCore

final class DepthSamplerTests: XCTestCase {

    func testNearestIgnoresInvalidAndPicksMin() {
        let s = DepthSampler()
        let nearest = s.nearestDistance(depths: [3.0, 0.0, 1.4, .nan, 2.2])
        XCTAssertEqual(nearest!, 1.4, accuracy: 0.0001)  // 0.0 与 nan 被过滤
    }

    func testReturnsNilWhenAllInvalid() {
        let s = DepthSampler()
        XCTAssertNil(s.nearestDistance(depths: [0.0, .nan, -1.0]))
    }

    func testConfidenceFilter() {
        let s = DepthSampler(minConfidence: 0.5)
        // 最近的 0.8m 置信度太低被过滤，应取 2.0m
        let nearest = s.nearestDistance(depths: [0.8, 2.0], confidences: [0.2, 0.9])
        XCTAssertEqual(nearest!, 2.0, accuracy: 0.0001)
    }

    func testZones() {
        let s = DepthSampler(dangerMeters: 1.0, cautionMeters: 2.5)
        XCTAssertEqual(s.zone(forNearest: 0.6), .danger)
        XCTAssertEqual(s.zone(forNearest: 1.8), .caution)
        XCTAssertEqual(s.zone(forNearest: 4.0), .clear)
        XCTAssertEqual(s.zone(forNearest: nil), .clear)
    }

    // 回归：置信度数组短于深度数组时，缺对应项的样本不得绕过置信度过滤。
    func testConfidenceArrayShorterThanDepthsDoesNotBypassFilter() {
        let s = DepthSampler(minConfidence: 0.5)
        // 尾部 0.5m 样本没有对应置信度项，必须被丢弃，结果取 2.0m。
        XCTAssertEqual(s.nearestDistance(depths: [2.0, 0.5], confidences: [0.9])!, 2.0, accuracy: 0.0001)
        // 空置信度数组 → 所有样本都缺项 → 全部丢弃 → nil。
        XCTAssertNil(s.nearestDistance(depths: [1.0, 2.0], confidences: []))
    }

    func testEvaluate() {
        let s = DepthSampler(dangerMeters: 1.0, cautionMeters: 2.5)
        let r = s.evaluate(depths: [5.0, 0.7, 3.0])
        XCTAssertEqual(r.nearest!, 0.7, accuracy: 0.0001)
        XCTAssertEqual(r.zone, .danger)
    }
}
