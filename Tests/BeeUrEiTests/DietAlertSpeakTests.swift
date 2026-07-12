import XCTest
@testable import BeeUrEi

/// 个人化营养预警**播报文案**：名称本地化（中文"糖/盐"）、空即 nil、只报关注且 high 的。
final class DietAlertSpeakTests: XCTestCase {

    func testSingleLocalizedChinese() {
        XCTAssertEqual(FramingStrings.dietAlertSpeak(highNutrients: ["sugars"], .zh),
                       "⚠️ 你关注的营养偏高：糖。")
    }

    func testMultipleOrderedEnglish() {
        XCTAssertEqual(FramingStrings.dietAlertSpeak(highNutrients: ["sugars", "salt"], .en),
                       "⚠️ High in what you watch: sugar, salt. ")
    }

    func testEmptyReturnsNil() {
        XCTAssertNil(FramingStrings.dietAlertSpeak(highNutrients: [], .zh))
    }

    func testSelectableNutrientsAllLocalizedNonEmpty() {
        // 勾选界面 4 项都有非空本地化名。
        for key in FramingStrings.selectableNutrients {
            XCTAssertFalse(FramingStrings.nutrientDisplay(key, .zh).isEmpty)
            XCTAssertFalse(FramingStrings.nutrientDisplay(key, .en).isEmpty)
        }
        XCTAssertEqual(FramingStrings.selectableNutrients, ["sugars", "salt", "saturated-fat", "fat"])
    }
}
