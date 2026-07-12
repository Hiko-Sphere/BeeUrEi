import XCTest
@testable import BeeUrEi

/// 个人化过敏原预警**播报文案**（安全攸关）：名称须本地化（中文用户听"花生"非"peanuts"）、含有/微量分级、空即 nil。
final class AllergenAlertSpeakTests: XCTestCase {

    func testContainedLocalizedChinese() {
        // 名称走 allergenDisplay 本地化：peanuts→花生。
        XCTAssertEqual(FramingStrings.allergenAlertSpeak(contained: ["peanuts"], traces: [], .zh),
                       "⚠️ 过敏警告！含有你标记的过敏原：花生。")
    }

    func testTracesOnly() {
        XCTAssertEqual(FramingStrings.allergenAlertSpeak(contained: [], traces: ["milk"], .zh),
                       "⚠️ 过敏警告！可能含微量：牛奶。")
    }

    func testContainedAndTracesGraded() {
        XCTAssertEqual(FramingStrings.allergenAlertSpeak(contained: ["peanuts"], traces: ["milk"], .zh),
                       "⚠️ 过敏警告！含有你标记的过敏原：花生；可能含微量：牛奶。")
    }

    func testEnglish() {
        XCTAssertEqual(FramingStrings.allergenAlertSpeak(contained: ["peanuts"], traces: [], .en),
                       "⚠️ Allergy warning! contains your flagged allergen: peanuts. ")
    }

    func testEmptyReturnsNil() {
        // 无命中 → nil（调用方省略；绝不据此播"安全"）。
        XCTAssertNil(FramingStrings.allergenAlertSpeak(contained: [], traces: [], .zh))
    }

    func testSelectableAllergensAllLocalizedNonEmpty() {
        // 设置页 14+1 项都应有非空本地化名（勾选界面不出现空/原始 key）。
        for key in FramingStrings.selectableAllergens {
            XCTAssertFalse(FramingStrings.allergenDisplay(key, .zh).isEmpty)
            XCTAssertFalse(FramingStrings.allergenDisplay(key, .en).isEmpty)
        }
    }
}
