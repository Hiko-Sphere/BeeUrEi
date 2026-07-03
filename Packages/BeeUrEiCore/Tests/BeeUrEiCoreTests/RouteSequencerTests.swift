import XCTest
@testable import BeeUrEiCore

final class RouteSequencerTests: XCTestCase {

    // 同经度下距离纯由纬度差决定：米/度 = R·π/180 = 111194.93（R=6371000，与 Geo.haversine 一致）。
    private let mPerDegLat = 111_194.93
    private func north(of baseLat: Double, meters: Double) -> Double { baseLat + meters / mPerDegLat }

    private let baseLat = 31.2300, lon = 121.4700
    // 两个转向点 + 终点，沿正北一条线（同经度，便于精确控制距离）。
    private func makeSequencer(arrival: Double = 15) -> RouteSequencer {
        let m0 = RouteSequencer.Maneuver(coordinate: Coordinate(lat: baseLat, lon: lon), instruction: "左转")
        let m1 = RouteSequencer.Maneuver(coordinate: Coordinate(lat: north(of: baseLat, meters: 200), lon: lon), instruction: "右转")
        let dest = Coordinate(lat: north(of: baseLat, meters: 400), lon: lon)
        return RouteSequencer(maneuvers: [m0, m1], destination: dest, arrivalRadiusMeters: arrival)
    }

    // MARK: 越过转向点推进

    func testAdvancesPastManeuverOnRecede() {
        var seq = makeSequencer()
        // 趋近 m0：30m 外 → 5m → 2m（记录 minDist=2）。
        _ = seq.update(lat: north(of: baseLat, meters: -30), lon: lon, level: .precise)
        _ = seq.update(lat: north(of: baseLat, meters: -5), lon: lon, level: .precise)
        let atClosest = seq.update(lat: north(of: baseLat, meters: -2), lon: lon, level: .precise)
        XCTAssertEqual(atClosest.stepIndex, 0)
        XCTAssertFalse(atClosest.advanced)
        // 越过并回升：+8m（streak1）→ +12m（streak2 → 推进）。WaypointAdvance 默认 recedeMargin4/confirm2。
        let receding1 = seq.update(lat: north(of: baseLat, meters: 8), lon: lon, level: .precise)
        XCTAssertFalse(receding1.advanced)
        let advanced = seq.update(lat: north(of: baseLat, meters: 12), lon: lon, level: .precise)
        XCTAssertTrue(advanced.advanced)      // 本帧越过 m0
        XCTAssertEqual(advanced.stepIndex, 0) // 决策 stepIndex 是本帧趋近的（m0）
        XCTAssertEqual(seq.stepIndex, 1)      // 序列内部已推进到 m1
    }

    func testNoAdvanceWhenAccuracyNone() {
        var seq = makeSequencer()
        // 同样的越过几何，但 level=.none：GPS 噪声大，绝不几何推进（防抖动吞掉转向点）。
        _ = seq.update(lat: north(of: baseLat, meters: -5), lon: lon, level: .none)
        _ = seq.update(lat: north(of: baseLat, meters: -2), lon: lon, level: .none)
        _ = seq.update(lat: north(of: baseLat, meters: 8), lon: lon, level: .none)
        let d = seq.update(lat: north(of: baseLat, meters: 12), lon: lon, level: .none)
        XCTAssertFalse(d.advanced)
        XCTAssertEqual(seq.stepIndex, 0) // 未推进，仍指向 m0
    }

    // MARK: 到达判定的精度门控（安全不变量）

    func testArrivalRequiresPrecise() {
        var seq = makeSequencer()
        seq.jump(to: 2) // 直接跳到"走完全部转向"（stepIndex==count）
        XCTAssertTrue(seq.isHeadingToDestination)
        let destLat = north(of: baseLat, meters: 400)
        // 进入到达半径（距终点 ~5m）但精度仅 .beacon → 不宣布到达，只报接近。
        let beacon = seq.update(lat: north(of: destLat, meters: -5), lon: lon, level: .beacon)
        XCTAssertFalse(beacon.arrived)
        XCTAssertTrue(beacon.approachingDestination)
        // 同样位置但 .precise → 宣布到达。
        let precise = seq.update(lat: north(of: destLat, meters: -5), lon: lon, level: .precise)
        XCTAssertTrue(precise.arrived)
        XCTAssertFalse(precise.approachingDestination)
    }

    func testNotArrivedWhenOutsideRadius() {
        var seq = makeSequencer()
        seq.jump(to: 2)
        let destLat = north(of: baseLat, meters: 400)
        let far = seq.update(lat: north(of: destLat, meters: -40), lon: lon, level: .precise) // 40m 外
        XCTAssertFalse(far.arrived)
        XCTAssertFalse(far.approachingDestination)
        XCTAssertEqual(far.target, Coordinate(lat: destLat, lon: lon)) // 目标已是终点
    }

    // MARK: 走完转向后直奔终点：不再播转向

    func testSilentAnnouncementWhenHeadingToDestination() {
        var seq = makeSequencer()
        seq.jump(to: 2)
        let d = seq.update(lat: north(of: baseLat, meters: 380), lon: lon, level: .precise)
        XCTAssertFalse(d.announcement.shouldAnnounce) // 直奔终点阶段不播转向
    }

    // MARK: 转向播报（委托 RouteProgress，验证串接正确）

    func testAnnouncesImminentTurnAtHighCertaintyWhenPrecise() {
        var seq = makeSequencer()
        // 距 m0 约 3m 且高精度 → RouteProgress 给"现在左转"高确定性指令。
        let d = seq.update(lat: north(of: baseLat, meters: -3), lon: lon, level: .precise)
        XCTAssertTrue(d.announcement.shouldAnnounce)
        XCTAssertTrue(d.announcement.isHighCertainty)
        XCTAssertEqual(d.announcement.text, SpokenStrings.maneuverNow("左转", .zh))
    }

    func testBeaconLevelNeverHighCertainty() {
        var seq = makeSequencer()
        // 同样 3m 内但 .beacon 精度 → 有提示但绝不下"现在"高确定性指令。
        let d = seq.update(lat: north(of: baseLat, meters: -3), lon: lon, level: .beacon)
        XCTAssertTrue(d.announcement.shouldAnnounce)
        XCTAssertFalse(d.announcement.isHighCertainty)
    }

    func testFarFromManeuverStaysSilent() {
        var seq = makeSequencer()
        let d = seq.update(lat: north(of: baseLat, meters: -100), lon: lon, level: .precise) // 100m 外
        XCTAssertFalse(d.announcement.shouldAnnounce)
        XCTAssertEqual(d.stepIndex, 0)
    }

    // MARK: 偏航汇入跳转

    func testJumpClampsAndResetsAdvance() {
        var seq = makeSequencer()
        seq.jump(to: 99)                 // 越界 → 夹到 count(=2)
        XCTAssertEqual(seq.stepIndex, 2)
        XCTAssertTrue(seq.isHeadingToDestination)
        seq.jump(to: -5)                 // 负 → 夹到 0
        XCTAssertEqual(seq.stepIndex, 0)
    }

    func testJumpResetsWaypointBaselineSoStaleRecedeDoesNotInstantlyAdvance() {
        var seq = makeSequencer()
        // 先在 m0 附近建立"已接近"基线（minDist 变小）。
        _ = seq.update(lat: north(of: baseLat, meters: -2), lon: lon, level: .precise)
        // 汇入跳回 m0（同索引）——应重置越过基线，避免用旧 minDist 立刻误判越过。
        seq.jump(to: 0)
        // 跳转后一帧在远处：不应因残留 minDist 而推进。
        let d = seq.update(lat: north(of: baseLat, meters: 30), lon: lon, level: .precise)
        XCTAssertFalse(d.advanced)
        XCTAssertEqual(seq.stepIndex, 0)
    }

    // MARK: 边界：空转向列表 / 非有限输入

    func testEmptyManeuversHeadsStraightToDestination() {
        let dest = Coordinate(lat: north(of: baseLat, meters: 100), lon: lon)
        var seq = RouteSequencer(maneuvers: [], destination: dest)
        XCTAssertTrue(seq.isHeadingToDestination)
        let d = seq.update(lat: baseLat, lon: lon, level: .precise)
        XCTAssertEqual(d.stepIndex, 0)
        XCTAssertEqual(d.target, dest)
        XCTAssertFalse(d.arrived) // 100m 外
    }

    func testNonFiniteInputYieldsInfiniteDistanceNoCrash() {
        var seq = makeSequencer()
        let d = seq.update(lat: .nan, lon: lon, level: .precise)
        XCTAssertFalse(d.advanced)          // 非有限不推进
        XCTAssertFalse(d.arrived)
        XCTAssertEqual(seq.stepIndex, 0)
    }

    func testResetReturnsToFirstManeuver() {
        var seq = makeSequencer()
        seq.jump(to: 2)
        seq.reset()
        XCTAssertEqual(seq.stepIndex, 0)
        XCTAssertFalse(seq.isHeadingToDestination)
    }
}
