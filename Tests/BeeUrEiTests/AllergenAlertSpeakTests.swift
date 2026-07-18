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

    /// 安全不变量：AllergenAlert.matched 回的是**产品原键**（OFF 常给具体品类 almonds/salmon/shrimps 而非大类），
    /// 故 categoryOfSpecific 的每个具体键都须有**中文名**——否则中文用户扫到该品类会听原始英文（"almonds"）而非
    /// "杏仁"，个人化过敏警告的关键词读不懂（安全攸关）。以 categoryOfSpecific 为真相源，日后加映射漏配中文即红。
    func testSpecificAllergenVarietiesLocalizedInChinese() {
        func hasCJK(_ s: String) -> Bool { s.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }
        for (specific, _) in AllergenAlert.categoryOfSpecific {
            let zh = FramingStrings.allergenDisplay(specific, .zh)
            XCTAssertTrue(hasCJK(zh), "具体过敏原 '\(specific)' 缺中文名，会给中文用户读原始英文：\(zh)")
            XCTAssertFalse(FramingStrings.allergenDisplay(specific, .en).isEmpty) // 英文侧非空（兜底/显式皆可）
        }
    }
}
