import XCTest
@testable import BeeUrEiCore

/// 路线缓存纯逻辑：LRU 覆盖/淘汰、key+地区匹配、14 天时效——断网降级的正确性基座。
final class PlannedRouteCacheTests: XCTestCase {
    private func entry(_ key: String, region: String = "china", at ms: Double = 1000) -> CachedPlannedRoute {
        CachedPlannedRoute(key: key, regionRaw: region,
                           maneuvers: [.init(lat: 31.2, lon: 121.4, instruction: "直行")],
                           route: [Coordinate(lat: 31.2, lon: 121.4), Coordinate(lat: 31.21, lon: 121.41)],
                           destLat: 31.21, destLon: 121.41, savedAtMs: ms)
    }

    func testNormalizeKey() {
        XCTAssertEqual(PlannedRouteCacheLogic.normalizeKey("  家乐福 "), "家乐福")
        XCTAssertEqual(PlannedRouteCacheLogic.normalizeKey("Carrefour "), "carrefour")
    }

    func testUpsertReplacesSameKeyAndKeepsCap() {
        var list = PlannedRouteCacheLogic.upserting(entry("a", at: 1), into: [])
        list = PlannedRouteCacheLogic.upserting(entry("b", at: 2), into: list)
        list = PlannedRouteCacheLogic.upserting(entry("a", at: 3), into: list) // 覆盖并置顶
        XCTAssertEqual(list.count, 2)
        XCTAssertEqual(list[0].key, "a")
        XCTAssertEqual(list[0].savedAtMs, 3)

        // 超上限淘汰最旧
        for i in 0..<12 { list = PlannedRouteCacheLogic.upserting(entry("k\(i)", at: Double(10 + i)), into: list, cap: 10) }
        XCTAssertEqual(list.count, 10)
        XCTAssertEqual(list[0].key, "k11")
        XCTAssertFalse(list.contains { $0.key == "a" }) // 最旧的被挤出
    }

    func testSameKeyDifferentRegionAreDistinct() {
        // 同名目的地在两地区坐标系不同（china=GCJ-02）——绝不互相覆盖/互相命中。
        var list = PlannedRouteCacheLogic.upserting(entry("家", region: "china", at: 1), into: [])
        list = PlannedRouteCacheLogic.upserting(entry("家", region: "overseas", at: 2), into: list)
        XCTAssertEqual(list.count, 2)
        XCTAssertEqual(PlannedRouteCacheLogic.lookup(key: "家", regionRaw: "china", in: list, nowMs: 10)?.savedAtMs, 1)
        XCTAssertEqual(PlannedRouteCacheLogic.lookup(key: "家", regionRaw: "overseas", in: list, nowMs: 10)?.savedAtMs, 2)
    }

    func testLookupRespectsMaxAge() {
        let list = [entry("a", at: 0)]
        let day = 86_400_000.0
        XCTAssertNotNil(PlannedRouteCacheLogic.lookup(key: "a", regionRaw: "china", in: list, nowMs: 13 * day))
        XCTAssertNil(PlannedRouteCacheLogic.lookup(key: "a", regionRaw: "china", in: list, nowMs: 15 * day)) // 过期宁缺勿给
        // 未来时间戳（时钟回拨产物）不可信：不命中
        let future = [entry("a", at: 100 * day)]
        XCTAssertNil(PlannedRouteCacheLogic.lookup(key: "a", regionRaw: "china", in: future, nowMs: 1 * day))
    }

    func testCodableRoundTrip() {
        let e = entry("家到菜场", at: 42)
        let data = try! JSONEncoder().encode([e])
        let back = try! JSONDecoder().decode([CachedPlannedRoute].self, from: data)
        XCTAssertEqual(back, [e]) // 折线/转向点/坐标全程无损（UserDefaults JSON 壳的正确性基座）
    }
}
