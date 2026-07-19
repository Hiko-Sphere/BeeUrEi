import XCTest
@testable import BeeUrEiCore

/// 路线名模糊匹配：全等优先/唯一包含/歧义与无匹配返回 nil（宁可不选也不选错——人工路线选错比选不中更危险）。
final class SavedRouteMatcherTests: XCTestCase {

    func testExactAndNormalizedMatch() {
        XCTAssertEqual(SavedRouteMatcher.match(spoken: "家到菜场", names: ["家到菜场", "去医院"]), 0)
        // 归一化：空格/大小写/"的"不影响（语音识别常插空格、用户常带"的"）。
        XCTAssertEqual(SavedRouteMatcher.match(spoken: "家到 菜场", names: ["家到菜场"]), 0)
        XCTAssertEqual(SavedRouteMatcher.match(spoken: "妈妈画的路", names: ["妈妈画路"]), 0)
        XCTAssertEqual(SavedRouteMatcher.match(spoken: "Home To Market", names: ["home to market"]), 0)
        // 全角空格（U+3000，中文 IME/粘贴常混入）与制表符同样剥除——此前只剥 ASCII 空格会漏配。
        XCTAssertEqual(SavedRouteMatcher.match(spoken: "家到菜场", names: ["家到\u{3000}菜场"]), 0)   // 存名含全角空格
        XCTAssertEqual(SavedRouteMatcher.match(spoken: "家到\u{3000}菜场", names: ["家到菜场"]), 0)   // 说的含全角空格
        XCTAssertEqual(SavedRouteMatcher.match(spoken: "家到\t菜场", names: ["家到菜场"]), 0)          // 制表符
    }

    func testUniqueContainmentBothDirections() {
        // 说的是存名的子串（"菜场" ⊂ "家到菜场"）。
        XCTAssertEqual(SavedRouteMatcher.match(spoken: "菜场", names: ["家到菜场", "去医院"]), 0)
        // 说的比存名长（"走家到菜市场的那条" ⊃ "家到菜市场"…此处互向包含）。
        XCTAssertEqual(SavedRouteMatcher.match(spoken: "老家到菜市场", names: ["家到菜市场", "去公园"]), 0)
    }

    func testAmbiguousAndNoMatchReturnNil() {
        // 两条都含"菜场"→ 歧义，绝不猜（调用方读出全部路线名）。
        XCTAssertNil(SavedRouteMatcher.match(spoken: "菜场", names: ["家到菜场", "公司到菜场"]))
        XCTAssertNil(SavedRouteMatcher.match(spoken: "火车站", names: ["家到菜场", "去医院"]))
        XCTAssertNil(SavedRouteMatcher.match(spoken: "", names: ["家到菜场"]))
        XCTAssertNil(SavedRouteMatcher.match(spoken: "菜场", names: []))
    }

    func testExactBeatsContainment() {
        // "菜场"全等命中第 1 条时，即便还有含它的更长名也取全等那条。
        XCTAssertEqual(SavedRouteMatcher.match(spoken: "菜场", names: ["去菜场的路", "菜场"]), 1)
    }
}
