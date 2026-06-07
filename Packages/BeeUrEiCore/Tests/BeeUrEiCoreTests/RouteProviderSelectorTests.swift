import XCTest
@testable import BeeUrEiCore

final class RouteProviderSelectorTests: XCTestCase {

    private let selector = RouteProviderSelector()

    func testProviderByRegion() {
        XCTAssertEqual(selector.provider(for: .overseas), .mapKit)
        XCTAssertEqual(selector.provider(for: .china), .licensedChinaSDK)
    }

    func testContinuousNetwork() {
        XCTAssertTrue(selector.requiresContinuousNetwork(for: .china))
        XCTAssertFalse(selector.requiresContinuousNetwork(for: .overseas))
    }
}

final class RoutingFallbackTests: XCTestCase {

    private let fallback = RoutingFallback()

    func testAccessibleDataKeepsAccessibleRoute() {
        let d = fallback.decide(hasAccessibleData: true)
        XCTAssertEqual(d.mode, .accessible)
        XCTAssertNil(d.advisory)
    }

    func testMissingDataDowngrades() {
        let d = fallback.decide(hasAccessibleData: false)
        XCTAssertEqual(d.mode, .ordinaryWithAvoidance)
        XCTAssertNotNil(d.advisory)
    }
}
