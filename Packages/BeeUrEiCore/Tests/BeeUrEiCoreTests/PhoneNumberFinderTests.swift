import XCTest
@testable import BeeUrEiCore

/// 电话号码抽取：手机分组、座机/服务号/国际、非电话数字串不误配、去重。
final class PhoneNumberFinderTests: XCTestCase {
    func testMobileGrouped() {
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["联系电话 13812345678"]), ["138 1234 5678"])
        // 印刷带分隔也能识别，统一按 3-4-4 念。
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["139-1234-5678"]), ["139 1234 5678"])
    }

    func testLandlineServiceInternational() {
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["座机 010-87654321"]), ["010-87654321"])
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["客服 400-820-8820"]), ["400-820-8820"])
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["Tel +44 20 7946 0958"]), ["+44 20 7946 0958"])
    }

    func testMultipleNumbersOneCard() {
        let r = PhoneNumberFinder.find(texts: ["手机 13800001111", "传真 020-12345678"])
        XCTAssertEqual(r.count, 2)
        XCTAssertEqual(r[0], "138 0000 1111")
        XCTAssertTrue(r[1].contains("020"))
    }

    func testNonPhoneDigitsRejected() {
        // 年份/价格/条码/日期都不是电话前缀 → 不误配。
        XCTAssertTrue(PhoneNumberFinder.find(texts: ["2026.07.15", "￥12345", "6901234567890"]).isEmpty)
        // 11 位但非 1[3-9] 开头（如 2 开头）不算手机。
        XCTAssertTrue(PhoneNumberFinder.find(texts: ["20260715999"]).isEmpty)
        // 手机第二位 1/2（不在 3-9）不算。
        XCTAssertTrue(PhoneNumberFinder.find(texts: ["12012345678"]).isEmpty)
    }

    func testDotSeparatedNumbers() {
        // 点分隔（名片/欧洲写法常见）此前被点截断成碎片而漏识——现能识别。
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["电话 138.1234.5678"]), ["138 1234 5678"]) // 手机点分→统一 3-4-4
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["Tél 01.42.34.56.78"]), ["01.42.34.56.78"]) // 法式座机点分（0 开头 10 位）
        XCTAssertTrue(PhoneNumberFinder.find(texts: ["座机 010.8765.4321"]).first!.contains("010"))
    }

    func testDotSeparatedNonPhonesStillRejected() {
        // 加了点分隔字符后，日期/价格/IP/版本号仍被长度+前缀门控拒绝（不误配）。
        XCTAssertTrue(PhoneNumberFinder.find(texts: ["日期 2026.07.15", "价格 13.50", "IP 192.168.1.100", "版本 2.0.1"]).isEmpty)
    }

    func testChinaMobileWithCountryCodeGrouped() {
        // +86 + 11 位手机 → "+86 3-4-4"（否则 13 位连读，盲人 TTS 听不清）。
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["+8613812345678"]), ["+86 138 1234 5678"])
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["联系 +86 138 0000 1111"]), ["+86 138 0000 1111"])
        // 非中国的 + 号国际号仍原样（不强套 3-4-4）。
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["+44 20 7946 0958"]), ["+44 20 7946 0958"])
    }

    func testDedup() {
        // 同号不同印刷分隔 → 只算一个。
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["13812345678", "138 1234 5678", "138-1234-5678"]).count, 1)
    }

    /// 对抗复审 HIGH：+1 美/加号（区号 3-9）裸数字恰为 11 位/1 开头/次位 3-9，绝不能误当中国 130 号段手机（拨错人）。
    func testUSNumberNotMisreadAsChineseMobile() {
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["+1 305 555 0199"]), ["+1 305 555 0199"]) // 国际号原样读，不重组
        XCTAssertFalse(PhoneNumberFinder.find(texts: ["+1 702 555 0100"]).contains("170 2555 0100"))
        // 真中国手机（无 +）仍正常分组；+86 仍逐组念。
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["13812345678"]), ["138 1234 5678"])
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["+8613812345678"]), ["+86 138 1234 5678"])
    }

    /// 对抗复审 MED：IP/坐标式点分串（数字恰以 400 开头）不得误当 400 客服号读给盲人。
    func testDottedCoordinateNotMisreadAs400Service() {
        XCTAssertTrue(PhoneNumberFinder.find(texts: ["定位 400.820.88.20"]).isEmpty) // 4 组点分=坐标/IP，拒
        XCTAssertEqual(PhoneNumberFinder.find(texts: ["客服 400-820-8820"]), ["400-820-8820"]) // 真 400 号仍识别
    }
}
