import XCTest
@testable import BeeUrEiCore

/// 个人化过敏原预警比对（安全攸关）：漏判=可能吃到过敏原；误"安全"=假安心可致命。
final class AllergenAlertTests: XCTestCase {

    func testContainedHit() {
        let r = AllergenAlert.matched(productAllergens: ["milk", "peanuts"], productTraces: [],
                                      userAllergens: ["peanuts"])
        XCTAssertEqual(r.contained, ["peanuts"])
        XCTAssertEqual(r.traces, [])
    }

    func testTraceHitSeparate() {
        // 用户过敏原只出现在"可能含微量"里 → 归 traces，不归 contained（严重过敏者据此分级）。
        let r = AllergenAlert.matched(productAllergens: ["milk"], productTraces: ["peanuts"],
                                      userAllergens: ["peanuts"])
        XCTAssertEqual(r.contained, [])
        XCTAssertEqual(r.traces, ["peanuts"])
    }

    func testContainedNotRepeatedInTraces() {
        // 同一过敏原既在含有又在微量 → 只报 contained（更严重），不在 traces 重复。
        let r = AllergenAlert.matched(productAllergens: ["peanuts"], productTraces: ["peanuts", "milk"],
                                      userAllergens: ["peanuts", "milk"])
        XCTAssertEqual(r.contained, ["peanuts"])
        XCTAssertEqual(r.traces, ["milk"]) // milk 只在微量 → traces；peanuts 含有已报、不重复
    }

    func testNoUserAllergensNoAlert() {
        // 用户没标记任何过敏原 → 永不预警（即便产品含过敏原，全量播报另有兜底）。
        let r = AllergenAlert.matched(productAllergens: ["milk", "peanuts"], productTraces: ["eggs"],
                                      userAllergens: [])
        XCTAssertEqual(r.contained, [])
        XCTAssertEqual(r.traces, [])
    }

    func testNoIntersectionNoAlert() {
        // 有交集才报；无交集 → 不报（且绝不据此报"安全"，那是调用方的红线）。
        let r = AllergenAlert.matched(productAllergens: ["milk"], productTraces: ["eggs"],
                                      userAllergens: ["peanuts", "fish"])
        XCTAssertEqual(r.contained, [])
        XCTAssertEqual(r.traces, [])
    }

    func testCaseInsensitiveAndDedup() {
        // 大小写不敏感 + 去重（OCR/标签大小写混杂、同标签重复）。
        let r = AllergenAlert.matched(productAllergens: ["Peanuts", "PEANUTS", "milk"], productTraces: [],
                                      userAllergens: ["peanuts"])
        XCTAssertEqual(r.contained, ["peanuts"]) // 大小写归一 + 去重，只一条
    }

    func testOrderFollowsProductTags() {
        // 保持产品标注顺序（确定性）。
        let r = AllergenAlert.matched(productAllergens: ["milk", "peanuts", "eggs"], productTraces: [],
                                      userAllergens: ["eggs", "milk", "peanuts"])
        XCTAssertEqual(r.contained, ["milk", "peanuts", "eggs"])
    }

    func testSpecificAllergenMatchesUserCategory() {
        // 产品标具体品类"almonds"、用户只标 EU 大类"nuts" → 命中（此前漏判：树坚果过敏者扫杏仁产品无醒目预警）。
        let r = AllergenAlert.matched(productAllergens: ["milk", "almonds"], productTraces: [],
                                      userAllergens: ["nuts"])
        XCTAssertEqual(r.contained, ["almonds"]) // 报回包装原键，与全量清单一致
        XCTAssertEqual(r.traces, [])
    }

    func testCategoryExpansionAcrossFamilies() {
        // 含麸质谷物→gluten、甲壳类具体→crustaceans、大豆别名→soybeans、鱼类具体→fish。
        XCTAssertEqual(AllergenAlert.matched(productAllergens: ["wheat"], productTraces: [], userAllergens: ["gluten"]).contained, ["wheat"])
        XCTAssertEqual(AllergenAlert.matched(productAllergens: ["shrimps"], productTraces: [], userAllergens: ["crustaceans"]).contained, ["shrimps"])
        XCTAssertEqual(AllergenAlert.matched(productAllergens: ["soy"], productTraces: [], userAllergens: ["soybeans"]).contained, ["soy"])
        XCTAssertEqual(AllergenAlert.matched(productAllergens: ["salmon"], productTraces: [], userAllergens: ["fish"]).contained, ["salmon"])
    }

    func testPeanutsDoNotMatchTreeNutsCategory() {
        // 花生是豆科、非树坚果：用户标"nuts"绝不能因产品含"peanuts"误报（映射为分类学包含关系，只增真命中）。
        XCTAssertEqual(AllergenAlert.matched(productAllergens: ["peanuts"], productTraces: [], userAllergens: ["nuts"]).contained, [])
        // 泛"gluten"不反推为具体"wheat"（用户只标 wheat 时，产品泛标 gluten 可能来自大麦/黑麦，不误报 wheat）。
        XCTAssertEqual(AllergenAlert.matched(productAllergens: ["gluten"], productTraces: [], userAllergens: ["wheat"]).contained, [])
    }

    func testCategoryExpansionAppliesToTracesToo() {
        // 微量支路同样归并：产品"可能含微量 hazelnuts"、用户"nuts" → 归 traces（不误当 contained）。
        let r = AllergenAlert.matched(productAllergens: [], productTraces: ["hazelnuts"], userAllergens: ["nuts"])
        XCTAssertEqual(r.contained, [])
        XCTAssertEqual(r.traces, ["hazelnuts"])
    }
}
