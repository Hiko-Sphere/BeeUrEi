import XCTest
@testable import BeeUrEi

/// 国内路线响应解码回归（C1 实时逐向导航的数据契约）。
final class AMapRouteDecodingTests: XCTestCase {

    func testDecodesRouteWithPolylineAndDestination() throws {
        let json = """
        {"destination":"116.40,39.90","destinationLat":39.90,"destinationLon":116.40,
         "steps":[{"instruction":"向东步行","distanceMeters":120,
                   "polyline":[[39.901,116.401],[39.902,116.402]]},
                  {"instruction":"右转","distanceMeters":30,"polyline":[[39.902,116.402]]}]}
        """.data(using: .utf8)!
        let route = try JSONDecoder().decode(AMapWalkRoute.self, from: json)
        XCTAssertEqual(route.destinationLat, 39.90)
        XCTAssertEqual(route.steps.count, 2)
        XCTAssertEqual(route.steps[0].polyline?.first?[0], 39.901)
    }

    func testOldBackendWithoutPolylineStillDecodes() throws {
        // 旧后端无 polyline/目的地坐标：可解码（App 退化为静态步骤列表），绝不丢整条路线。
        let json = """
        {"destination":"116.40,39.90","steps":[{"instruction":"向东步行","distanceMeters":null}]}
        """.data(using: .utf8)!
        let route = try JSONDecoder().decode(AMapWalkRoute.self, from: json)
        XCTAssertNil(route.destinationLat)
        XCTAssertNil(route.steps[0].polyline)
        XCTAssertNil(route.steps[0].distanceMeters) // null 距离不致解码失败（见审查 #8）
    }
}
