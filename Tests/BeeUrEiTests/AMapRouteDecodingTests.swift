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
        XCTAssertNil(route.distanceMeters)          // 旧后端无全程字段 → nil（概览退回本地累距）
        XCTAssertNil(route.durationSeconds)
    }

    func testDecodesAuthoritativeRouteTotals() throws {
        // 服务端一直在返高德权威全程里程/时长——此前 Codable 静默丢弃，概览一律本地累距（低估真实路程）。
        let json = """
        {"destinationLat":39.90,"destinationLon":116.40,"distanceMeters":1234,"durationSeconds":987,
         "steps":[{"instruction":"向东步行","distanceMeters":120,"polyline":[[39.901,116.401]]}]}
        """.data(using: .utf8)!
        let route = try JSONDecoder().decode(AMapWalkRoute.self, from: json)
        XCTAssertEqual(route.distanceMeters, 1234)
        XCTAssertEqual(route.durationSeconds, 987)
    }
}

/// 全程概览数据源选择（服务端权威 vs 本地累距兜底）。选错的后果：报给盲人的"全程约 X 米、
/// 预计 Y 分钟"系统性低估（转向点连线短于真实道路），影响"要不要带够时间"的判断。
final class NavigationOverviewTotalsTests: XCTestCase {

    func testPrefersServerAuthoritativeTotals() {
        let r = NavigationViewModel.overviewTotals(serverMeters: 1500, serverSeconds: 1200,
                                                   fallbackMeters: 1100, fallbackEtaSeconds: 900)
        XCTAssertEqual(r?.meters, 1500)       // 高德按真实道路算，优先
        XCTAssertEqual(r?.etaSeconds, 1200)   // 时长用高德步行模型，非默认步速
    }

    func testFallsBackWhenServerMissingOrInvalid() {
        // 海外/自定义/旧后端：无服务端值 → 本地累距。
        let miss = NavigationViewModel.overviewTotals(serverMeters: nil, serverSeconds: nil,
                                                      fallbackMeters: 1100, fallbackEtaSeconds: 900)
        XCTAssertEqual(miss?.meters, 1100)
        XCTAssertEqual(miss?.etaSeconds, 900)
        // 坏服务端值（0/负/NaN）不收，退本地——上游 bug 不得把"全程约 0 米"报给盲人。
        for bad: (Double, Double) in [(0, 600), (1500, -1), (.nan, 600), (1500, .infinity)] {
            let r = NavigationViewModel.overviewTotals(serverMeters: bad.0, serverSeconds: bad.1,
                                                       fallbackMeters: 1100, fallbackEtaSeconds: 900)
            XCTAssertEqual(r?.meters, 1100, "坏服务端值 \(bad) 应退回本地兜底")
        }
    }

    func testNilWhenNoSourceAvailable() {
        // 两路都无/都坏 → nil（不凭空报概览）。
        XCTAssertNil(NavigationViewModel.overviewTotals(serverMeters: nil, serverSeconds: nil,
                                                        fallbackMeters: nil, fallbackEtaSeconds: nil))
        XCTAssertNil(NavigationViewModel.overviewTotals(serverMeters: .nan, serverSeconds: 1,
                                                        fallbackMeters: 0, fallbackEtaSeconds: nil))
    }
}
