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
}
