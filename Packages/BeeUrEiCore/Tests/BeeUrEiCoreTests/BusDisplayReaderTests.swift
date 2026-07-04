import XCTest
@testable import BeeUrEiCore

/// 公交车头牌行挑选：线路号优先、终点站取最长、电话/序列号杂讯丢弃。
final class BusDisplayReaderTests: XCTestCase {

    func testRouteNumberFirst() {
        XCTAssertEqual(BusDisplayReader.pick(texts: ["开往火车站", "103"]), ["103", "开往火车站"])
        XCTAssertEqual(BusDisplayReader.pick(texts: ["103路", "开往东站"]), ["103路", "开往东站"])
    }

    func testPhoneNumberNoiseDropped() {
        // 车身广告电话（≥8 连续数字）整行丢弃，不会顶掉终点站
        XCTAssertEqual(BusDisplayReader.pick(texts: ["103", "热线12345678", "开往东站"]), ["103", "开往东站"])
    }

    func testDestinationByLength() {
        // 无线路号时：不含数字的行按长度取最长（终点站通常比站牌杂字长）
        XCTAssertEqual(BusDisplayReader.pick(texts: ["快", "Central Station"]), ["Central Station", "快"])
    }

    func testDedupAndWhitespace() {
        XCTAssertEqual(BusDisplayReader.pick(texts: [" 103 ", "103", ""]), ["103"])
    }

    func testEmpty() {
        XCTAssertEqual(BusDisplayReader.pick(texts: []), [])
    }

    func testDigitRun() {
        XCTAssertEqual(BusDisplayReader.longestDigitRun(in: "热线12345678"), 8)
        XCTAssertEqual(BusDisplayReader.longestDigitRun(in: "103路"), 3)
        XCTAssertEqual(BusDisplayReader.longestDigitRun(in: "开往东站"), 0)
    }

    func testChineseNumeralDestinationNotDropped() {
        // 回归：含中文数字的中文终点站（>8 字）曾被 Character.isNumber 误判"含数字"，
        // 既进不了终点站列表又超线路号长度上限，被整行丢弃，只剩杂字"始发站"被读。
        // 修复后："开往二七广场火车站"应作为终点站正常呈现。
        XCTAssertEqual(
            BusDisplayReader.pick(texts: ["8路", "开往二七广场火车站", "始发站"]),
            ["8路", "开往二七广场火车站"]
        )
    }

    func testChineseNumeralDestinationShort() {
        // 短的含中文数字终点站（"二环"）曾被误塞进线路号列表、排到真线路号之前打乱顺序。
        // 修复后应识别为终点站，线路号仍居首。
        XCTAssertEqual(
            BusDisplayReader.pick(texts: ["2路", "二环"]),
            ["2路", "二环"]
        )
    }

    func testChineseNumeralNotCountedAsRouteDigit() {
        // 无阿拉伯数字、仅含中文数字的行不算线路号（谓词与电话号识别口径一致）。
        XCTAssertFalse("机场一线".contains(where: BusDisplayReader.isAsciiDigit))
        XCTAssertTrue("103路".contains(where: BusDisplayReader.isAsciiDigit))
    }
}
