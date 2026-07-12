import XCTest
@testable import BeeUrEiCore

/// 个人化营养预警比对：漏判高糖/高盐=健康管理失效；误报=无（只报事实 high）。
final class NutrientAlertTests: XCTestCase {
    let order = ["sugars", "salt", "saturated-fat", "fat"]

    func testHighFlaggedHit() {
        let r = NutrientAlert.highFlagged(levels: ["sugars": "high", "salt": "moderate"],
                                          flagged: ["sugars"], order: order)
        XCTAssertEqual(r, ["sugars"])
    }

    func testOnlyHighNotModerateOrLow() {
        // 关注 salt 但产品只是 moderate → 不预警（moderate/low 交既有全量播报）。
        let r = NutrientAlert.highFlagged(levels: ["salt": "moderate", "sugars": "low"],
                                          flagged: ["salt", "sugars"], order: order)
        XCTAssertEqual(r, [])
    }

    func testMultipleHighInCanonicalOrder() {
        // 多项命中按 order 固定次序（糖→盐→饱和脂肪→脂肪），与传入 flagged 的集合无序无关。
        let r = NutrientAlert.highFlagged(levels: ["fat": "high", "sugars": "high", "salt": "high"],
                                          flagged: ["fat", "salt", "sugars"], order: order)
        XCTAssertEqual(r, ["sugars", "salt", "fat"])
    }

    func testHighButNotFlaggedExcluded() {
        // salt 含量 high 但用户没关注 salt → 不报（个人化核心：只报**关注的**，不是所有 high）。
        let r = NutrientAlert.highFlagged(levels: ["sugars": "high", "salt": "high"],
                                          flagged: ["sugars"], order: order)
        XCTAssertEqual(r, ["sugars"]) // salt 虽 high 但未关注 → 排除
    }

    func testNoFlaggedNoAlert() {
        let r = NutrientAlert.highFlagged(levels: ["sugars": "high"], flagged: [], order: order)
        XCTAssertEqual(r, [])
    }

    func testFlaggedButNotHighNoAlert() {
        // 关注 sugars，但产品无 sugars 档（缺数据）→ 不预警（缺数据≠不高）。
        let r = NutrientAlert.highFlagged(levels: ["salt": "high"], flagged: ["sugars"], order: order)
        XCTAssertEqual(r, [])
    }

    func testCaseInsensitiveLevel() {
        // 档位大小写不敏感（"HIGH"/"High" 亦命中）。
        let r = NutrientAlert.highFlagged(levels: ["sugars": "HIGH"], flagged: ["sugars"], order: order)
        XCTAssertEqual(r, ["sugars"])
    }
}
