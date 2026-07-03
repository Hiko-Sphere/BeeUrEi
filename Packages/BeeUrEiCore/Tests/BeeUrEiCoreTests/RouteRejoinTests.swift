import XCTest
@testable import BeeUrEiCore

/// 自定义路线偏航重新汇入：安全不变量=只指向前方最近航点、太远返回 nil（绝不重规划、绝不乱指）。
final class RouteRejoinTests: XCTestCase {
    // 一条向东的直线路线，相邻航点约 111m（0.001° 经度 ≈ 111m×cos(lat)，取赤道附近简化）。
    private let route = [
        Coordinate(lat: 0, lon: 0.000),
        Coordinate(lat: 0, lon: 0.001),
        Coordinate(lat: 0, lon: 0.002),
        Coordinate(lat: 0, lon: 0.003),
    ]

    func testPicksNearestForwardWaypoint() {
        // 人在航点2 附近偏北 ~50m：当前目标是 1，应汇入 2（前方最近），而不是回头也不是跳到 3。
        let idx = RouteRejoin.rejoinIndex(lat: 0.00045, lon: 0.002, waypoints: route, currentIndex: 1)
        XCTAssertEqual(idx, 2)
    }

    func testNeverPointsBackward() {
        // 人贴着航点1（~11m），但当前目标已是 2：即使 1 近得多也只考虑 ≥2 的航点 → 汇入 2（~111m，在半径内）。
        let idx = RouteRejoin.rejoinIndex(lat: 0.0001, lon: 0.001, waypoints: route, currentIndex: 2)
        XCTAssertEqual(idx, 2)
    }

    func testAllForwardTooFarReturnsNil() {
        // 人离所有前方航点都 >150m → nil（播报"原路返回"，不乱指）。
        let idx = RouteRejoin.rejoinIndex(lat: 0.01, lon: 0.01, waypoints: route, currentIndex: 0)
        XCTAssertNil(idx)
    }

    func testCurrentIndexClampedAtEnd() {
        // currentIndex 越界（已过完全部转向点）：夹到最后一个航点，人在其旁则返回它。
        let idx = RouteRejoin.rejoinIndex(lat: 0.0003, lon: 0.003, waypoints: route, currentIndex: 99)
        XCTAssertEqual(idx, 3)
    }

    func testNonFiniteInputsReturnNil() {
        XCTAssertNil(RouteRejoin.rejoinIndex(lat: .nan, lon: 0, waypoints: route, currentIndex: 0))
        XCTAssertNil(RouteRejoin.rejoinIndex(lat: 0, lon: .infinity, waypoints: route, currentIndex: 0))
        XCTAssertNil(RouteRejoin.rejoinIndex(lat: 0, lon: 0, waypoints: [], currentIndex: 0))
    }

    func testGarbageWaypointSkippedNotPoisoning() {
        // 路线里混入坏航点（NaN）：跳过它，仍能选中其后的合法航点。
        let dirty = [Coordinate(lat: .nan, lon: .nan), Coordinate(lat: 0, lon: 0.0005)]
        let idx = RouteRejoin.rejoinIndex(lat: 0, lon: 0.0006, waypoints: dirty, currentIndex: 0)
        XCTAssertEqual(idx, 1)
    }
}
