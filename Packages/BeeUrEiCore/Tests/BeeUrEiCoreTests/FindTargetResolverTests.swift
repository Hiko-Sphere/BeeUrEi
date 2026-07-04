import XCTest
@testable import BeeUrEiCore

/// 语音"找X"的物名解析：已教物品优先、其次通用类别、都不匹配则 none。
final class FindTargetResolverTests: XCTestCase {
    let taught = ["我的钥匙", "水杯"]
    let categories = [(label: "chair", name: "椅子"), (label: "bottle", name: "瓶子")]

    func resolve(_ s: String) -> FindResolution {
        FindTargetResolver.resolve(spoken: s, taughtNames: taught, categories: categories)
    }

    func testTaughtItemPreferredAndFuzzy() {
        XCTAssertEqual(resolve("水杯"), .taught("水杯"))       // 精确
        XCTAssertEqual(resolve("钥匙"), .taught("我的钥匙"))   // "钥匙" ↔ "我的钥匙" 双向包含
        XCTAssertEqual(resolve("我的钥匙"), .taught("我的钥匙"))
    }

    func testCategoryWhenNotTaught() {
        XCTAssertEqual(resolve("椅子"), .category("chair"))
        XCTAssertEqual(resolve("瓶子"), .category("bottle"))
    }

    func testTaughtBeatsCategory() {
        // 若"瓶子"也被教过，则已教优先。
        let r = FindTargetResolver.resolve(spoken: "瓶子", taughtNames: ["瓶子"], categories: categories)
        XCTAssertEqual(r, .taught("瓶子"))
    }

    func testNoneWhenUnknown() {
        XCTAssertEqual(resolve("独角兽"), .none)
        XCTAssertEqual(resolve(""), .none)
        XCTAssertEqual(resolve("   "), .none)
    }

    func testEnglishCaseInsensitive() {
        let r = FindTargetResolver.resolve(spoken: "KEYS", taughtNames: ["my keys"], categories: [])
        XCTAssertEqual(r, .taught("my keys"))
    }

    /// 对抗复审 MED：精确类别命中优先于模糊已教命中——已教"杯子架"不得在用户说"杯子"时抢过精确类别"杯子"。
    func testExactCategoryBeatsFuzzyTaught() {
        let r = FindTargetResolver.resolve(spoken: "杯子", taughtNames: ["杯子架"], categories: [(label: "cup", name: "杯子")])
        XCTAssertEqual(r, .category("cup"))
    }

    /// 对抗复审 MED：短已教名/ASCII 子串不得靠包含劫持无关查询（"机"不命中"手机"；"key"不命中"monkey"）。
    func testShortOrSubstringTaughtDoesNotHijack() {
        XCTAssertEqual(FindTargetResolver.resolve(spoken: "手机", taughtNames: ["机"], categories: []), .none)     // 1 字候选不子串
        XCTAssertEqual(FindTargetResolver.resolve(spoken: "monkey", taughtNames: ["key"], categories: []), .none) // ASCII 须词边界
        // 正常双向包含仍工作。
        XCTAssertEqual(FindTargetResolver.resolve(spoken: "钥匙", taughtNames: ["我的钥匙"], categories: []), .taught("我的钥匙"))
        XCTAssertEqual(FindTargetResolver.resolve(spoken: "my keys", taughtNames: ["keys"], categories: []), .taught("keys"))
    }
}
