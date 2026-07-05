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

    // 回归（姊妹缺口）：坏坐标在**路线点**（非当前点）上同样危险——当前点守卫了，路点却没守。
    // 多点路线全为 NaN 路点时，每段 pointToSegment 返回 NaN，min(.greatestFiniteMagnitude, NaN)=1.8e308
    // → isOffRoute 误判偏航、把在路上的盲人引离正确路线（"极危险"）。补路点 isFinite 守卫后一律"未知不动作"。
    func testNonFiniteRoutePointNotOffRoute() {
        // 当前点有效、路线含非有限路点：应返 nil / 不判偏航（而非被洗成 1.8e308>阈值=true）。
        for bad in [Double.nan, .infinity, -.infinity] {
            let allBad = [Coordinate(lat: bad, lon: bad), Coordinate(lat: bad, lon: 0.001)]
            XCTAssertNil(detector.distanceToRoute(lat: 0, lon: 0.0005, route: allBad))
            XCTAssertFalse(detector.isOffRoute(lat: 0, lon: 0.0005, route: allBad))
            // 仅个别路点坏（其余有效）也一律"未知不动作"，不给出可能误导的距离。
            let oneBad = [Coordinate(lat: 0, lon: 0), Coordinate(lat: bad, lon: 0.001), Coordinate(lat: 0, lon: 0.002)]
            XCTAssertNil(detector.distanceToRoute(lat: 0, lon: 0.0015, route: oneBad))
            XCTAssertFalse(detector.isOffRoute(lat: 0, lon: 0.0015, route: oneBad))
            // 单点路线坏路点：此前走 Geo 返 NaN（isOffRoute false），现统一返 nil，多点/单点一致。
            XCTAssertNil(detector.distanceToRoute(lat: 0, lon: 0.0005, route: [Coordinate(lat: bad, lon: 0)]))
            XCTAssertFalse(detector.isOffRoute(lat: 0, lon: 0.0005, route: [Coordinate(lat: bad, lon: 0)]))
        }
        // 正常路线不受影响：有限路点照常算出距离、正确判定。
        let good = [Coordinate(lat: 0, lon: 0), Coordinate(lat: 0, lon: 0.001)]
        XCTAssertNotNil(detector.distanceToRoute(lat: 0, lon: 0.0005, route: good))
        XCTAssertFalse(detector.isOffRoute(lat: 0, lon: 0.0005, route: good))
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

    /// 对抗复审 LOW：maxDistance<=0 退化配置时 cue 必须返回 nil，绝不外发 0/0=NaN 的音高/节奏。
    func testDegenerateMaxDistanceReturnsNilNotNaN() {
        XCTAssertNil(ProximityCueMapper(maxDistance: 0).cue(distanceMeters: 0))
        XCTAssertNil(ProximityCueMapper(maxDistance: -1).cue(distanceMeters: 0))
        XCTAssertNotNil(ProximityCueMapper(maxDistance: 4).cue(distanceMeters: 2)) // 正常配置仍工作
    }
}
