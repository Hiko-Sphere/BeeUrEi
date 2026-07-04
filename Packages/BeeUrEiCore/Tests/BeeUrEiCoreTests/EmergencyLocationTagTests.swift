import XCTest
@testable import BeeUrEiCore

final class EmergencyLocationTagTests: XCTestCase {
    private let createdAt: Double = 1_700_000_000_000

    func testLastKnownWithAgeGivesAbsoluteFixTime() {
        let r = EmergencyLocationTag.info(data: ["locSource": "lastKnown", "locAgeSec": "300"], createdAtMs: createdAt)
        XCTAssertTrue(r.stale)
        XCTAssertEqual(r.fixAtMs, createdAt - 300_000) // 5 分钟前的定位
    }

    func testLiveSourceNotStale() {
        let r = EmergencyLocationTag.info(data: ["locSource": "live", "lat": "31.2"], createdAtMs: createdAt)
        XCTAssertEqual(r, EmergencyLocationTag.Info(stale: false, fixAtMs: nil))
    }

    func testLegacyServerWithoutSourceFieldTreatedAsLive() {
        // 旧版服务端无 locSource 字段：按实时处理（向后兼容，不误标）。
        XCTAssertEqual(EmergencyLocationTag.info(data: ["lat": "31.2", "lon": "121.5"], createdAtMs: createdAt),
                       EmergencyLocationTag.Info(stale: false, fixAtMs: nil))
        XCTAssertEqual(EmergencyLocationTag.info(data: nil, createdAtMs: createdAt),
                       EmergencyLocationTag.Info(stale: false, fixAtMs: nil))
    }

    func testLastKnownWithBadAgeStillStaleWithoutFixTime() {
        for bad in [nil, "xx", "-5"] as [String?] {
            var d = ["locSource": "lastKnown"]
            if let bad { d["locAgeSec"] = bad }
            let r = EmergencyLocationTag.info(data: d, createdAtMs: createdAt)
            XCTAssertTrue(r.stale)
            XCTAssertNil(r.fixAtMs)
        }
    }

    func testZeroAgeFixesAtAlertTime() {
        let r = EmergencyLocationTag.info(data: ["locSource": "lastKnown", "locAgeSec": "0"], createdAtMs: createdAt)
        XCTAssertEqual(r, EmergencyLocationTag.Info(stale: true, fixAtMs: createdAt))
    }

    /// 对抗复审 LOW：age 巨值使 age*1000 溢出成 inf → fixAtMs 变 -inf/NaN 被当坏时刻展示。
    /// 算不出有限定位时刻就只标"最后已知"、不给时刻（stale 仍为 true）。
    func testHugeAgeDoesNotProduceNonFiniteFixTime() {
        let r = EmergencyLocationTag.info(data: ["locSource": "lastKnown", "locAgeSec": "1e308"], createdAtMs: createdAt)
        XCTAssertTrue(r.stale)
        XCTAssertNil(r.fixAtMs) // 非有限 → 不给时刻
    }
}
