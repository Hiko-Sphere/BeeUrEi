import XCTest
@testable import BeeUrEiCore

/// 名片码解析：vCard/MECARD 姓名·电话·邮箱·单位；多电话；参数化 TEL；非名片返回 nil。
final class VCardParserTests: XCTestCase {
    func testVCardBasic() {
        let v = "BEGIN:VCARD\nVERSION:3.0\nFN:张三\nORG:蜂之眼科技\nTEL;TYPE=CELL:13812345678\nEMAIL:zhang@example.com\nEND:VCARD"
        let c = VCardParser.parse(v)!
        XCTAssertEqual(c.name, "张三")
        XCTAssertEqual(c.org, "蜂之眼科技")
        XCTAssertEqual(c.phones, ["13812345678"])
        XCTAssertEqual(c.emails, ["zhang@example.com"])
    }

    func testVCardMultiPhoneAndNFallback() {
        // 无 FN 用 N 兜底（结构化姓名 ; 转空格）；多个 TEL 收集。
        let v = "BEGIN:VCARD\nN:李;四;;;\nTEL;TYPE=WORK:010-88886666\nTEL;TYPE=CELL:13900001111\nEND:VCARD"
        let c = VCardParser.parse(v)!
        XCTAssertEqual(c.name, "李 四")
        XCTAssertEqual(c.phones, ["010-88886666", "13900001111"])
        XCTAssertTrue(c.emails.isEmpty)
    }

    func testMECARD() {
        let m = "MECARD:N:王五;TEL:13712340000;EMAIL:wang@x.com;ORG:某公司;;"
        let c = VCardParser.parse(m)!
        XCTAssertEqual(c.name, "王五")
        XCTAssertEqual(c.phones, ["13712340000"])
        XCTAssertEqual(c.emails, ["wang@x.com"])
        XCTAssertEqual(c.org, "某公司")
    }

    func testVCardParameterizedNameKeysCharset() {
        // 回归：中文名片常带 CHARSET 参数（FN;CHARSET=UTF-8）。旧码精确匹配 "FN" 会漏、姓名丢失。
        let v = "BEGIN:VCARD\nVERSION:2.1\nFN;CHARSET=UTF-8:张三\nORG;CHARSET=UTF-8:蜂之眼\nTEL;TYPE=CELL:13812345678\nEND:VCARD"
        let c = VCardParser.parse(v)!
        XCTAssertEqual(c.name, "张三")   // 关键：带参数的 FN 仍取到姓名
        XCTAssertEqual(c.org, "蜂之眼")
        XCTAssertEqual(c.phones, ["13812345678"])
        // N 带参数亦然（无 FN 时兜底）。
        let v2 = "BEGIN:VCARD\nN;CHARSET=UTF-8:李;四;;;\nTEL:010-8888\nEND:VCARD"
        XCTAssertEqual(VCardParser.parse(v2)?.name, "李 四")
    }

    func testVCardGroupedPropertiesAndNoNicknameConfusion() {
        // Apple 分组属性 item1.TEL → 剥组前缀后当 TEL；NICKNAME/NOTE 绝不被当成姓名(N)。
        let v = "BEGIN:VCARD\nFN:王五\nitem1.TEL;TYPE=CELL:13700001234\nNICKNAME:阿五\nNOTE:随便写\nEND:VCARD"
        let c = VCardParser.parse(v)!
        XCTAssertEqual(c.name, "王五")            // FN 取名，NICKNAME/NOTE 不干扰
        XCTAssertEqual(c.phones, ["13700001234"]) // 分组的 item1.TEL 被正确收集
    }

    func testNotAContactReturnsNil() {
        XCTAssertNil(VCardParser.parse("https://example.com"))
        XCTAssertNil(VCardParser.parse("just some text"))
        // 是 vCard 壳但无任何有用字段 → nil（不报空名片）。
        XCTAssertNil(VCardParser.parse("BEGIN:VCARD\nVERSION:3.0\nEND:VCARD"))
    }
}
