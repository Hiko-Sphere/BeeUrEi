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
}
