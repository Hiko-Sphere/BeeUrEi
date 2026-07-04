import XCTest
@testable import BeeUrEiCore

final class EmergencyPhoneFallbackTests: XCTestCase {
    private func c(_ name: String, _ phone: String, emergency: Bool = false, accepted: Bool = true) -> EmergencyPhoneFallback.Candidate {
        .init(name: name, phone: phone, isEmergency: emergency, isAccepted: accepted)
    }

    // MARK: 挑人

    func testPrefersEmergencyContactWithPhone() {
        let picked = EmergencyPhoneFallback.pick([
            c("普通友", "13800000001"),
            c("妈妈", "13800000002", emergency: true),
        ])
        XCTAssertEqual(picked?.name, "妈妈") // 紧急联系人优先，即便排在后面
    }

    func testFallsBackToAnyAcceptedWithPhone() {
        let picked = EmergencyPhoneFallback.pick([
            c("紧急无电话", "", emergency: true),        // 紧急但没电话：拨不了
            c("普通友", "13800000001"),
        ])
        XCTAssertEqual(picked?.name, "普通友")
    }

    func testSkipsPendingAndUnusablePhones() {
        XCTAssertNil(EmergencyPhoneFallback.pick([
            c("待确认", "13800000001", emergency: true, accepted: false), // pending 未经同意，不拨
            c("坏号", "12", emergency: true),                             // 净化后 <3 位
            c("空号", "  "),
        ]))
        XCTAssertNil(EmergencyPhoneFallback.pick([]))
    }

    func testSameTierKeepsInputOrder() {
        let picked = EmergencyPhoneFallback.pick([c("甲", "13800000001"), c("乙", "13800000002")])
        XCTAssertEqual(picked?.name, "甲") // 无紧急联系人时取输入序第一个（服务端稳定序）
    }

    // MARK: tel URL 消毒

    func testTelURLSanitizesFormatting() {
        // 空格/连字符/括号是常见输入——直接插值会让 URL(string:) 返回 nil（亲友页现入口的隐患）。
        XCTAssertEqual(EmergencyPhoneFallback.telURLString("138 0000 0001"), "tel://13800000001")
        XCTAssertEqual(EmergencyPhoneFallback.telURLString("(021) 6555-0123"), "tel://02165550123")
        XCTAssertEqual(EmergencyPhoneFallback.telURLString("+86 138-0000-0001"), "tel://+8613800000001")
    }

    func testTelURLRejectsUnusable() {
        XCTAssertNil(EmergencyPhoneFallback.telURLString(""))
        XCTAssertNil(EmergencyPhoneFallback.telURLString("12"))       // 太短
        XCTAssertNil(EmergencyPhoneFallback.telURLString("no phone")) // 无数字
    }

    func testTelURLRejectsNonAsciiDigits() {
        // 回归：全角数字（从中文网页复制电话号极常见）/中文数字/阿拉伯-印度数字 曾因 Character.isNumber
        // 对它们亦为 true 而被保留进 tel:// URL——iOS 拨不出去。无数据网兜底拨号宁可返回 nil 让调用方
        // 播报"请直接呼叫求助"，也不生成拨不出去的 URL。
        XCTAssertNil(EmergencyPhoneFallback.telURLString("１３８００００００００"))   // 全角数字
        XCTAssertNil(EmergencyPhoneFallback.telURLString("一三八零零零零"))         // 中文数字
        XCTAssertNil(EmergencyPhoneFallback.telURLString("١٢٣٤٥٦"))               // 阿拉伯-印度数字
        // 全角/半角混排：仅半角部分算可拨；不足 3 位半角数字则不可拨。
        XCTAssertNil(EmergencyPhoneFallback.telURLString("１２ 3"))                 // 仅 1 位半角
        XCTAssertEqual(EmergencyPhoneFallback.telURLString("１２ 345"), "tel://345") // 半角部分够 3 位
    }

    /// 对抗复审 LOW：前导换行/回车（多行联系人粘贴常见）不得丢掉国家码 + 前缀（否则生成拨不通的错号）。
    func testLeadingNewlineKeepsPlusPrefix() {
        XCTAssertEqual(EmergencyPhoneFallback.telURLString("\n+8613800000001"), "tel://+8613800000001")
        XCTAssertEqual(EmergencyPhoneFallback.telURLString("\r\n +8613800000001"), "tel://+8613800000001")
        XCTAssertEqual(EmergencyPhoneFallback.telURLString("\t+8613800000001"), "tel://+8613800000001") // tab 原本就对
    }
}
