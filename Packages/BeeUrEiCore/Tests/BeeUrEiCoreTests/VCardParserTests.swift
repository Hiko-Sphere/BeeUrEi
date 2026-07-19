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

    func testVCardTitleAndUrl() {
        // TITLE(职务) + URL(网址)：名片核心信息，此前被丢；参数化/分组前缀（item2.URL）也须解出。CRLF 换行照收。
        let v = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:王小明\r\nTITLE:销售经理\r\nORG:蜂之眼科技\r\nTEL:13800001111\r\nitem2.URL:https://beeurei.example.com\r\nEND:VCARD"
        let c = VCardParser.parse(v)!
        XCTAssertEqual(c.name, "王小明")
        XCTAssertEqual(c.title, "销售经理")
        XCTAssertEqual(c.org, "蜂之眼科技")
        XCTAssertEqual(c.url, "https://beeurei.example.com")
        // MECARD 有 URL（无 TITLE 字段）。
        let m = VCardParser.parse("MECARD:N:李四;TEL:13712340000;URL:https://foo.example;;")!
        XCTAssertEqual(m.url, "https://foo.example")
        XCTAssertNil(m.title)
        // 只有 TITLE（无名/无联系方式）也算有效名片（不当空）。
        XCTAssertEqual(VCardParser.parse("BEGIN:VCARD\nTITLE:CTO\nEND:VCARD")?.title, "CTO")
    }

    func testVCardAddress() {
        // ADR（地址）：名片核心信息之一，此前被丢——盲人扫名片听不到公司/住址、无从赴约或导航前往。补齐。
        // vCard ADR 结构化 `PO;EXT;街道;城市;省;邮编;国家`，多含空占位（;;）：跳空、其余以 ", " 连接。
        let v = "BEGIN:VCARD\nFN:张三\nADR;TYPE=WORK:;;科技路123号;北京市;;100085;中国\nTEL:13800001111\nEND:VCARD"
        XCTAssertEqual(VCardParser.parse(v)?.address, "科技路123号, 北京市, 100085, 中国")
        // 英文地址 + 参数化 ADR 键。
        XCTAssertEqual(VCardParser.parse("BEGIN:VCARD\nADR;TYPE=HOME:;;123 Main St;Springfield;IL;62704;USA\nEND:VCARD")?.address,
                       "123 Main St, Springfield, IL, 62704, USA")
        // 多条 ADR 取**首个**非空（名片常 WORK/HOME 两条）。
        XCTAssertEqual(VCardParser.parse("BEGIN:VCARD\nADR:;;;;;;\nADR:;;办公楼;上海;;;\nEND:VCARD")?.address, "办公楼, 上海")
        // vCard 转义：\, → 字面逗号（不被当组件分隔）；\n → 空格。
        XCTAssertEqual(VCardParser.parse("BEGIN:VCARD\nADR:;;123 Main St\\, Suite 5;City;;;\nEND:VCARD")?.address, "123 Main St, Suite 5, City")
        // 全空 ADR（;;;;;;）→ 无地址（不硬报空字符串）。
        XCTAssertNil(VCardParser.parse("BEGIN:VCARD\nADR:;;;;;;\nFN:x\nEND:VCARD")?.address)
        // MECARD ADR（逗号分组）：切分去空、", " 连接。
        XCTAssertEqual(VCardParser.parse("MECARD:N:李四;ADR:中关村大街,北京;TEL:13712340000;;")?.address, "中关村大街, 北京")
    }

    func testFormatVCardAddressUnit() {
        XCTAssertEqual(VCardParser.formatVCardAddress(";;街;城;省;邮;国"), "街, 城, 省, 邮, 国")
        XCTAssertEqual(VCardParser.formatVCardAddress(";;;;;;"), nil)          // 全空
        XCTAssertEqual(VCardParser.formatVCardAddress(""), nil)                // 空串
        XCTAssertEqual(VCardParser.formatVCardAddress("A\\;B;City"), "A;B, City") // \; → 字面分号不切
    }
}
