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
