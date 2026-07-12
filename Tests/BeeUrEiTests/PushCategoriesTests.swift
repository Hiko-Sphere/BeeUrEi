import XCTest
@testable import BeeUrEi

/// 推送分类静音：切换纯逻辑 + 类别表与服务端一致 + 双语文案。
/// 切换逻辑错误的后果：用户以为静音了却仍被打扰（或反向——想收的收不到），
/// 且回滚失败会留下"看着已静音实际没生效"的假状态。
final class PushCategoriesTests: XCTestCase {

    func testToggleMuteAddsOnceAndUnmuteRemoves() {
        // 静音（receive=false）：加入集合；重复静音不重复（幂等）。
        XCTAssertEqual(PushCategories.toggled(muted: [], key: "social", receive: false), ["social"])
        XCTAssertEqual(PushCategories.toggled(muted: ["social"], key: "social", receive: false), ["social"])
        // 恢复接收（receive=true）：移出；对未静音的恢复=无操作。
        XCTAssertEqual(PushCategories.toggled(muted: ["social", "route"], key: "social", receive: true), ["route"])
        XCTAssertEqual(PushCategories.toggled(muted: ["route"], key: "social", receive: true), ["route"])
    }

    func testToggleDoesNotDisturbOtherCategories() {
        XCTAssertEqual(PushCategories.toggled(muted: ["route", "location"], key: "social", receive: false),
                       ["route", "location", "social"])
    }

    func testKnownSetMatchesServerMutableCategories() {
        // 与服务端 MUTABLE_CATEGORIES=['social','route','location'] 一致（服务端 available 为权威，
        // 此表是旧服务端兜底——漂移会让旧兜底显出服务端拒收的开关）。危急类绝不在表内。
        XCTAssertEqual(PushCategories.known, ["social", "route", "location"])
        XCTAssertFalse(PushCategories.known.contains("emergency"))
        XCTAssertFalse(PushCategories.known.contains("call"))
    }

    func testLabelsBilingual() {
        XCTAssertEqual(PushCategories.label("social", .zh), "社交")
        XCTAssertEqual(PushCategories.label("route", .zh), "路线")
        XCTAssertEqual(PushCategories.label("location", .zh), "位置")
        XCTAssertEqual(PushCategories.label("unknown_key", .zh), "unknown_key") // 未知键原样显示不崩
        for key in PushCategories.known {
            for s in [PushCategories.label(key, .en), PushCategories.desc(key, .en)] {
                XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                               "英文文案混入中文：\(s)")
                XCTAssertFalse(s.isEmpty)
            }
        }
        // footer 必须点名"永不静音"的安全承诺（紧急/来电/安全报到）。
        XCTAssertTrue(PushCategories.footer(.zh).contains("永不静音"))
    }
}
