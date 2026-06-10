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
}
