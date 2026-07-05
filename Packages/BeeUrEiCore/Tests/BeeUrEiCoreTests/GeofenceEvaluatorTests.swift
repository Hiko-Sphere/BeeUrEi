import XCTest
@testable import BeeUrEiCore

/// 到达/离开围栏 + 滞回（与服务端 evaluateGeofences 同门槛）。1° 纬度≈111km，用纬度偏移造出确定距离。
final class GeofenceEvaluatorTests: XCTestCase {
    private let home = GeofenceEvaluator.Place(label: "家", lat: 39.9, lng: 116.4)

    func testArriveWithinEnterRadius() {
        // 从外(空 prevInside)进到 ~50m 内 → 新到达。
        let r = GeofenceEvaluator.evaluate(currentLat: 39.9 + 0.00045, currentLon: 116.4, places: [home], prevInside: [])
        XCTAssertEqual(r.arrived, ["家"])
        XCTAssertEqual(r.insideLabels, ["家"])
        XCTAssertTrue(r.departed.isEmpty)
    }

    func testNotArrivedBeyondEnterRadius() {
        // ~400m，超出 enterRadius(150) → 不算到达。
        let r = GeofenceEvaluator.evaluate(currentLat: 39.9 + 0.0036, currentLon: 116.4, places: [home], prevInside: [])
        XCTAssertTrue(r.arrived.isEmpty)
        XCTAssertTrue(r.insideLabels.isEmpty)
    }

    func testHysteresisStaysInsideBetweenEnterAndExit() {
        // 之前在内，现在 ~178m（>enter150 但 ≤exit200）→ 仍算在内、不判离开（滞回防边界抖动）。
        let r = GeofenceEvaluator.evaluate(currentLat: 39.9 + 0.0016, currentLon: 116.4, places: [home], prevInside: ["家"])
        XCTAssertTrue(r.departed.isEmpty)
        XCTAssertEqual(r.insideLabels, ["家"])
        XCTAssertTrue(r.arrived.isEmpty) // 已在内不重复报到达
    }

    func testSameDistanceOutsideDoesNotArrive() {
        // **同样 ~178m**、但之前在外 → 不到达（须进到 enterRadius 内才算入）——证明滞回真起作用。
        let r = GeofenceEvaluator.evaluate(currentLat: 39.9 + 0.0016, currentLon: 116.4, places: [home], prevInside: [])
        XCTAssertTrue(r.arrived.isEmpty)
        XCTAssertTrue(r.insideLabels.isEmpty)
    }

    func testDepartBeyondExitRadius() {
        // ~400m，越出 exitRadius(200) → 离开。
        let r = GeofenceEvaluator.evaluate(currentLat: 39.9 + 0.0036, currentLon: 116.4, places: [home], prevInside: ["家"])
        XCTAssertEqual(r.departed, ["家"])
        XCTAssertTrue(r.insideLabels.isEmpty)
    }

    func testBadCurrentLocationKeepsStateNoTrigger() {
        let r = GeofenceEvaluator.evaluate(currentLat: .nan, currentLon: 116.4, places: [home], prevInside: ["家"])
        XCTAssertTrue(r.arrived.isEmpty && r.departed.isEmpty)
        XCTAssertEqual(r.insideLabels, ["家"]) // 坏定位保持原状，绝不误判
    }

    func testBadPlaceCoordSkipped() {
        let bad = GeofenceEvaluator.Place(label: "坏", lat: .nan, lng: 116.4)
        let r = GeofenceEvaluator.evaluate(currentLat: 39.9, currentLon: 116.4, places: [bad], prevInside: [])
        XCTAssertTrue(r.arrived.isEmpty && r.insideLabels.isEmpty)
    }
}
