import XCTest
@testable import BeeUrEiCore

final class LatencyBudgetTests: XCTestCase {

    private let budget = LatencyBudget(targetSeconds: 0.8, maxSeconds: 1.3)

    func testVerdicts() {
        XCTAssertEqual(budget.verdict(latencySeconds: 0.5), .good)
        XCTAssertEqual(budget.verdict(latencySeconds: 0.8), .good)
        XCTAssertEqual(budget.verdict(latencySeconds: 1.0), .acceptable)
        XCTAssertEqual(budget.verdict(latencySeconds: 1.3), .acceptable)
        XCTAssertEqual(budget.verdict(latencySeconds: 1.6), .fail)
    }

    func testReactionDistance() {
        XCTAssertEqual(budget.reactionDistance(speedMetersPerSecond: 1.4, latencySeconds: 0.8),
                       1.12, accuracy: 0.0001)
        XCTAssertEqual(budget.reactionDistance(speedMetersPerSecond: -1, latencySeconds: 1), 0)
    }

    func testSufficientLead() {
        // 5m 处发现障碍，步速 1.0 m/s，延迟 1.0s → 反应距离 1.0m，可用 4.0m ≥ 2m
        XCTAssertTrue(budget.hasSufficientLead(detectionDistanceMeters: 5,
                                               speedMetersPerSecond: 1.0,
                                               latencySeconds: 1.0))
        // 2.5m 处发现，步速 1.4 m/s，延迟 1.0s → 反应 1.4m，可用 1.1m < 2m
        XCTAssertFalse(budget.hasSufficientLead(detectionDistanceMeters: 2.5,
                                                speedMetersPerSecond: 1.4,
                                                latencySeconds: 1.0))
    }
}
