import XCTest
@testable import BeeUrEiCore

final class PowerPolicyTests: XCTestCase {

    private let policy = PowerPolicy(lowBatteryThreshold: 0.2, criticalBatteryThreshold: 0.1)

    func testNominal() {
        let p = policy.plan(batteryLevel: 0.8, lowPowerMode: false)
        XCTAssertEqual(p.targetFPS, 15)
        XCTAssertNil(p.advisory)
    }

    func testLowPowerMode() {
        let p = policy.plan(batteryLevel: 0.8, lowPowerMode: true)
        XCTAssertEqual(p.targetFPS, 8)
        XCTAssertNotNil(p.advisory)
    }

    func testLowBattery() {
        XCTAssertEqual(policy.plan(batteryLevel: 0.15, lowPowerMode: false).targetFPS, 8)
    }

    func testCriticalBattery() {
        let p = policy.plan(batteryLevel: 0.05, lowPowerMode: false)
        XCTAssertEqual(p.targetFPS, 5)
        XCTAssertNotNil(p.advisory)
    }

    func testUnknownBatteryTreatedNominal() {
        XCTAssertEqual(policy.plan(batteryLevel: -1, lowPowerMode: false).targetFPS, 15)
    }
}

final class OffRouteDetectorTests: XCTestCase {

    private let detector = OffRouteDetector(thresholdMeters: 25)
    private let route = [Coordinate(lat: 0, lon: 0), Coordinate(lat: 0, lon: 0.001)]

    func testOnRoute() {
        let d = detector.distanceToRoute(lat: 0, lon: 0.0005, route: route)!
        XCTAssertLessThan(d, 5)
        XCTAssertFalse(detector.isOffRoute(lat: 0, lon: 0.0005, route: route))
    }

    func testOffRoute() {
        // 偏北约 111m
        XCTAssertTrue(detector.isOffRoute(lat: 0.001, lon: 0.0005, route: route))
    }

    func testEmptyRoute() {
        XCTAssertNil(detector.distanceToRoute(lat: 0, lon: 0, route: []))
        XCTAssertFalse(detector.isOffRoute(lat: 0, lon: 0, route: []))
    }

    func testSinglePointRoute() {
        let d = detector.distanceToRoute(lat: 0, lon: 0, route: [Coordinate(lat: 0, lon: 0.001)])!
        XCTAssertEqual(d, 111.32, accuracy: 2)
    }

    // 回归：跨反子午线(±180°)的在线点不得被误判为偏航。
    func testOnRouteAcrossAntimeridian() {
        let route = [Coordinate(lat: 0, lon: 179.999), Coordinate(lat: 0, lon: -179.999)]
        let d = detector.distanceToRoute(lat: 0, lon: 180, route: route)!
        XCTAssertLessThan(d, 5)
        XCTAssertFalse(detector.isOffRoute(lat: 0, lon: 180, route: route))
    }

    // 回归：投影落在线段端点之外时，按到端点距离计算（触发 t<0 夹取分支）。
    func testBeforeStartClampedToFirstEndpoint() {
        let d = detector.distanceToRoute(lat: 0, lon: -0.0005, route: route)!
        let toEndpoint = Geo.distanceMeters(fromLat: 0, fromLon: -0.0005, toLat: 0, toLon: 0)
        XCTAssertEqual(d, toEndpoint, accuracy: 0.5)
    }

    // 回归（HIGH）：坏 GPS 帧（NaN/±inf 坐标）在多点路线上曾被 min(.greatestFiniteMagnitude, NaN)
    // 洗成 1.8e308（有限、>阈值）→ 误判偏航、触发乱重规划/"请回到路线"。补 isFinite 守卫后一律
    // "未知不动作"：distanceToRoute→nil、isOffRoute→false。且单点/多点行为一致。
    func testNonFiniteFixNotOffRoute() {
        let multi = [Coordinate(lat: 0, lon: 0), Coordinate(lat: 0, lon: 0.001), Coordinate(lat: 0, lon: 0.002)]
        for badLat in [Double.nan, .infinity, -.infinity] {
            XCTAssertNil(detector.distanceToRoute(lat: badLat, lon: 0.0015, route: multi))
            XCTAssertFalse(detector.isOffRoute(lat: badLat, lon: 0.0015, route: multi))
            // 单点路线同样一致（此前走 Geo 返 NaN，现统一返 nil）。
            XCTAssertNil(detector.distanceToRoute(lat: badLat, lon: 0.0015, route: [Coordinate(lat: 0, lon: 0.001)]))
            XCTAssertFalse(detector.isOffRoute(lat: badLat, lon: 0.0015, route: [Coordinate(lat: 0, lon: 0.001)]))
        }
        // 非有限经度亦然。
        XCTAssertNil(detector.distanceToRoute(lat: 0, lon: .nan, route: multi))
        XCTAssertFalse(detector.isOffRoute(lat: 0, lon: .nan, route: multi))
    }
}

final class ProximityCueTests: XCTestCase {

    private let mapper = ProximityCueMapper(maxDistance: 4)

    func testNear() {
        let c = mapper.cue(distanceMeters: 0)!
        XCTAssertEqual(c.beepIntervalSeconds, 0.1, accuracy: 0.001)
        XCTAssertEqual(c.pitchHz, 1200, accuracy: 1)
    }

    func testFar() {
        let c = mapper.cue(distanceMeters: 4)!
        XCTAssertEqual(c.beepIntervalSeconds, 1.0, accuracy: 0.001)
        XCTAssertEqual(c.pitchHz, 600, accuracy: 1)
    }

    func testBeyondRangeIsNil() {
        XCTAssertNil(mapper.cue(distanceMeters: 5))
        XCTAssertNil(mapper.cue(distanceMeters: -1))
    }

    func testCloserIsFaster() {
        XCTAssertLessThan(mapper.cue(distanceMeters: 1)!.beepIntervalSeconds,
                          mapper.cue(distanceMeters: 3)!.beepIntervalSeconds)
    }
}
