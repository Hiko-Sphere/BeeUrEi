import XCTest
@testable import BeeUrEiCore

final class GeoTests: XCTestCase {

    func testBearingNorth() {
        let b = Geo.initialBearing(fromLat: 0, fromLon: 0, toLat: 1, toLon: 0)
        XCTAssertEqual(b, 0, accuracy: 0.5)
    }

    func testBearingEast() {
        let b = Geo.initialBearing(fromLat: 0, fromLon: 0, toLat: 0, toLon: 1)
        XCTAssertEqual(b, 90, accuracy: 0.5)
    }

    func testBearingWest() {
        let b = Geo.initialBearing(fromLat: 0, fromLon: 0, toLat: 0, toLon: -1)
        XCTAssertEqual(b, 270, accuracy: 0.5)
    }

    func testDistanceOneDegreeLonAtEquator() {
        let d = Geo.distanceMeters(fromLat: 0, fromLon: 0, toLat: 0, toLon: 1)
        XCTAssertEqual(d, 111_195, accuracy: 500)
    }

    func testDistanceZero() {
        XCTAssertEqual(Geo.distanceMeters(fromLat: 31.2, fromLon: 121.5, toLat: 31.2, toLon: 121.5), 0, accuracy: 0.001)
    }
}

final class BeaconDirectionTests: XCTestCase {

    func testStraightAhead() {
        let b = BeaconDirection(headingDegrees: 90, bearingDegrees: 90)
        XCTAssertEqual(b.relativeAzimuthDegrees, 0, accuracy: 0.0001)
        XCTAssertEqual(b.clockHour, 12)
    }

    func testRight() {
        let b = BeaconDirection(headingDegrees: 0, bearingDegrees: 90)
        XCTAssertEqual(b.relativeAzimuthDegrees, 90, accuracy: 0.0001)
        XCTAssertEqual(b.clockHour, 3)
    }

    func testLeft() {
        let b = BeaconDirection(headingDegrees: 0, bearingDegrees: 270)
        XCTAssertEqual(b.relativeAzimuthDegrees, -90, accuracy: 0.0001)
        XCTAssertEqual(b.clockHour, 9)
    }

    func testWrapAround() {
        let b = BeaconDirection(headingDegrees: 350, bearingDegrees: 10)
        XCTAssertEqual(b.relativeAzimuthDegrees, 20, accuracy: 0.0001)
        XCTAssertEqual(b.clockHour, 1)
    }

    // 头部追踪：身体航向 + 头部偏航 共同决定朝向（Q8）。
    func testHeadRelativeAzimuth() {
        // 头转向右 90°，目标在地理 90°（正东）→ 相对头部正前方。
        let head = BeaconDirection.relative(headingDegrees: 0, headYawDegrees: 90, bearingDegrees: 90)
        XCTAssertEqual(head.relativeAzimuthDegrees, 0, accuracy: 0.0001)
        XCTAssertEqual(head.clockHour, 12)
        // 无头追踪(yaw=0) 退化为纯身体航向。
        let body = BeaconDirection.relative(headingDegrees: 0, headYawDegrees: 0, bearingDegrees: 90)
        XCTAssertEqual(body.clockHour, 3)
    }

    // 回归：头部偏航非有限（AirPods 追踪掉帧）绝不能把信标兜成"正前方/12 点"、丢掉有效身体航向——退化为纯身体航向。
    func testNonFiniteHeadYawFallsBackToBodyHeading() {
        // 身体朝北(0)、目标正东(90)：纯身体航向应为 3 点钟。坏 yaw 不该把它变成 12 点。
        for badYaw in [Double.nan, .infinity, -.infinity] {
            let b = BeaconDirection.relative(headingDegrees: 0, headYawDegrees: badYaw, bearingDegrees: 90)
            XCTAssertEqual(b.clockHour, 3, "坏 headYaw 应退化为纯身体航向(3 点)，而非兜成正前方(12 点)；yaw=\(badYaw)")
            XCTAssertEqual(b.relativeAzimuthDegrees, 90, accuracy: 0.0001)
        }
    }

    // 回归：非有限 heading/bearing 不得崩溃，退化为「正前方/12 点」。
    func testNonFiniteInputDoesNotCrash() {
        XCTAssertEqual(BeaconDirection(headingDegrees: .nan, bearingDegrees: 90).clockHour, 12)
        XCTAssertEqual(BeaconDirection(headingDegrees: .infinity, bearingDegrees: 90).clockHour, 12)
        XCTAssertEqual(BeaconDirection(headingDegrees: 0, bearingDegrees: .nan).relativeAzimuthDegrees, 0, accuracy: 0.0001)
    }
}

final class RouteProgressTests: XCTestCase {

    private let progress = RouteProgress(announceWithinMeters: 20, imminentMeters: 5)

    func testTooFarStaysSilent() {
        let a = progress.decide(distanceToManeuverMeters: 50, instruction: "左转", level: .precise)
        XCTAssertFalse(a.shouldAnnounce)
    }

    func testNoneAccuracyStaysSilent() {
        let a = progress.decide(distanceToManeuverMeters: 3, instruction: "过马路", level: .none)
        XCTAssertFalse(a.shouldAnnounce)
    }

    func testApproachingAnnouncesDistance() {
        let a = progress.decide(distanceToManeuverMeters: 15, instruction: "左转", level: .precise)
        XCTAssertTrue(a.shouldAnnounce)
        XCTAssertFalse(a.isHighCertainty)
        XCTAssertEqual(a.text, "前方约 15 米后左转")
    }

    /// 英制单位：转向距离用英尺（决策/5米取档全在公制不变，仅输出按单位格式化）。收口 turn-by-turn 英制的漏网近距转向提示。
    func testManeuverDistanceRespectsImperialUnit() {
        func t(_ d: Double, _ l: Language) -> String? {
            progress.decide(distanceToManeuverMeters: d, instruction: l == .zh ? "左转" : "turn left",
                            level: .precise, language: l, unit: .imperial).text
        }
        XCTAssertEqual(t(15, .zh), "前方约 49英尺后左转")           // 15m 档 → 49 英尺
        XCTAssertEqual(t(15, .en), "In about 49 feet, turn left")
        XCTAssertEqual(t(20, .en), "In about 66 feet, turn left")   // 20m 档 → 66 英尺
        XCTAssertEqual(t(12, .en), "In about 33 feet, turn left")   // 12m→10m 档 → 33 英尺
        XCTAssertEqual(t(18, .en), t(20, .en))                      // 18、20 同 20m 档：英制文本仍稳定（去重生效）
        // 高确定性"现在转向"(≤5m)不带距离、不受单位影响。
        XCTAssertEqual(progress.decide(distanceToManeuverMeters: 3, instruction: "turn left",
                                       level: .precise, language: .en, unit: .imperial).text, "Now turn left")
    }

    /// 距离按 5 米档取整（防逐米刷屏）：同档内文本稳定（上层据此去重、只提醒一次），跨档才变。
    func testDistanceAnnouncedInFiveMeterBuckets() {
        func text(_ d: Double) -> String? { progress.decide(distanceToManeuverMeters: d, instruction: "左转", level: .precise).text }
        // 18、19、20 米同属"20 米档" → 文本相同（走路时逐米变化不会每米重播）。
        XCTAssertEqual(text(18), "前方约 20 米后左转")
        XCTAssertEqual(text(19), "前方约 20 米后左转")
        XCTAssertEqual(text(20), "前方约 20 米后左转")
        // 跨到 15 米档才变。
        XCTAssertEqual(text(17), "前方约 15 米后左转")
        XCTAssertEqual(text(13), "前方约 15 米后左转")
        XCTAssertEqual(text(12), "前方约 10 米后左转")
        // 逐米从 20 走到 12：文本只变 3 次（20→15→10），而非逐米 9 次。
        let seq = stride(from: 20.0, through: 12.0, by: -1).map { text($0)! }
        XCTAssertEqual(Set(seq).count, 3)
    }

    func testImminentHighCertaintyOnlyWhenPrecise() {
        let precise = progress.decide(distanceToManeuverMeters: 3, instruction: "过马路", level: .precise)
        XCTAssertTrue(precise.isHighCertainty)
        XCTAssertEqual(precise.text, "现在过马路")

        let beacon = progress.decide(distanceToManeuverMeters: 3, instruction: "过马路", level: .beacon)
        XCTAssertTrue(beacon.shouldAnnounce)
        XCTAssertFalse(beacon.isHighCertainty)   // 低精度不下「现在」
        XCTAssertEqual(beacon.text, "前方即将过马路")
    }

    // 回归：已越过转向点（负距离）绝不下达高确定性「现在……」指令。
    func testNegativeDistanceStaysSilent() {
        let a = progress.decide(distanceToManeuverMeters: -3, instruction: "过马路", level: .precise)
        XCTAssertFalse(a.shouldAnnounce)
        XCTAssertFalse(a.isHighCertainty)
    }
}
