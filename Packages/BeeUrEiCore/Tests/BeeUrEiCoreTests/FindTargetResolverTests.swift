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

    func testSeatSynonymResolvesToChair() {
        // 自然说法「空座位/座位/座椅/seat」→ chair 类别（否则座位≠椅子子串，「找空座位」会失败、拿不到座位占用播报）。
        for s in ["座位", "空座位", "座椅", "找个座位", "seat", "a seat", "empty seat"] {
            XCTAssertEqual(resolve(s), .category("chair"), "『\(s)』应解析为 chair 类别")
        }
    }

    func testSeatSynonymOnlyWhenChairFindable() {
        // 仅当 chair 在可找类别中才映射——否则绝不谎报「可找」（返回 none）。
        let r = FindTargetResolver.resolve(spoken: "空座位", taughtNames: [], categories: [(label: "bottle", name: "瓶子")])
        XCTAssertEqual(r, .none)
    }

    func testTaughtSeatItemBeatsSeatSynonym() {
        // 已教物品优先于座位同义词兜底：已教「座位垫」含「座位」→ 返回已教，不被兜底成 chair。
        let r = FindTargetResolver.resolve(spoken: "座位", taughtNames: ["座位垫"], categories: [(label: "chair", name: "椅子")])
        XCTAssertEqual(r, .taught("座位垫"))
    }

    func testCommonSynonymsResolveToCategories() {
        // 常见口语说法映射到规范类别（桌子≠餐桌、电话≠手机、水瓶≠瓶子…双向包含都不命中，靠同义词兜底）。
        let cats = [(label: "dining table", name: "餐桌"), (label: "toilet", name: "马桶"),
                    (label: "bottle", name: "瓶子"), (label: "cup", name: "杯子"),
                    (label: "cell phone", name: "手机"), (label: "backpack", name: "背包"),
                    (label: "chair", name: "椅子")]
        let cases: [(String, String)] = [
            ("桌子", "dining table"), ("书桌", "dining table"),
            ("厕所", "toilet"), ("洗手间", "toilet"), ("卫生间", "toilet"), ("restroom", "toilet"),
            ("水瓶", "bottle"), ("水杯", "cup"), ("茶杯", "cup"), ("mug", "cup"),
            ("电话", "cell phone"), ("cellphone", "cell phone"),
            ("书包", "backpack"), ("双肩包", "backpack"),
            ("凳子", "chair"),
        ]
        for (spoken, label) in cases {
            XCTAssertEqual(FindTargetResolver.resolve(spoken: spoken, taughtNames: [], categories: cats),
                           .category(label), "『\(spoken)』应解析为 \(label)")
        }
    }

    func testSynonymDoesNotFalseMatchUnrelated() {
        // 同义词不误配无关物：说「电视」（非可找类别，且与「电话」仅首字同）→ none，不硬塞成手机等。
        let cats = [(label: "chair", name: "椅子"), (label: "cell phone", name: "手机")]
        XCTAssertEqual(FindTargetResolver.resolve(spoken: "电视", taughtNames: [], categories: cats), .none)
    }

    func testSynonymGatedOnCategoryAvailable() {
        // 目标类别不在可找列表时，同义词也不谎报「可找」：只提供 chair 时说「桌子」→ none。
        let r = FindTargetResolver.resolve(spoken: "桌子", taughtNames: [], categories: [(label: "chair", name: "椅子")])
        XCTAssertEqual(r, .none)
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
