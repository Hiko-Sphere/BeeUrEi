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

    func testArrivalHintMinutesStopsImminent() {
        // 分钟。
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["103路", "还有3分钟"], language: .zh), "还有约3分钟")
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["B12", "5 min"], language: .en), "about 5 min")
        // 站数（分钟缺失时）。
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["还有2站"], language: .zh), "还有2站")
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["3 stops"], language: .en), "3 stops away")
        // 即将到站（最高优先，压过分钟/站）。
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["即将进站", "还有3分钟"], language: .zh), "即将到站")
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["Arriving"], language: .en), "arriving now")
    }

    func testArrivalHintZeroCountdownIsImminent() {
        // 倒计时读到 0 = 车已到站，必须播即将到站（此前 ≥1 门槛让 "0分钟"/"0站" 回落 nil，
        // 站台上的盲人对已进站的车毫无提示 → 错过车/以为还早）。
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["103路", "还有0分钟"], language: .zh), "即将到站")
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["0 min"], language: .en), "arriving now")
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["还有0站"], language: .zh), "即将到站")
        // 0 只来自真实"0分钟/0站"；地名里"站/分钟"前无数字仍不误报（stops/minutes 为 nil≠0）。
        XCTAssertNil(BusDisplayReader.arrivalHint(texts: ["开往火车站"], language: .zh))
    }

    func testArrivalHintNoFalsePositiveOnPlaceNames() {
        // CJK 地名里的"站/分钟"前无阿拉伯数字，绝不误报到站信息。
        XCTAssertNil(BusDisplayReader.arrivalHint(texts: ["开往二七广场火车站"], language: .zh)) // "站"前是"车"
        XCTAssertNil(BusDisplayReader.arrivalHint(texts: ["开往分钟寺"], language: .zh))         // "分钟"前是"往"
        XCTAssertNil(BusDisplayReader.arrivalHint(texts: ["103路", "开往人民广场"], language: .zh)) // 纯线路+终点，无到站信号
        // 越界值不当分钟（把长数字/杂讯误当分钟）。
        XCTAssertNil(BusDisplayReader.arrivalHint(texts: ["还有999分钟"], language: .zh)) // ≥120 视为杂讯
    }

    func testArrivalHintUnitWordBoundaries() {
        // 回归：单位是别的词的**子串**时，前面的数字绝不误当到站信息（此前 substring 匹配会误报）。
        // 英文 min ⊂ Mint/Minster/Ministry；stop ⊂ stopover。
        XCTAssertNil(BusDisplayReader.arrivalHint(texts: ["5 Mint Street"], language: .en))     // 曾误报 "about 5 min"
        XCTAssertNil(BusDisplayReader.arrivalHint(texts: ["8 Minster Road"], language: .en))
        XCTAssertNil(BusDisplayReader.arrivalHint(texts: ["3 Ministry Ave"], language: .en))
        // 中文"站台"(月台) ⊃ "站"：不能把 "2站台"(Platform 2) 误读成 "还有2站"。
        XCTAssertNil(BusDisplayReader.arrivalHint(texts: ["2站台"], language: .zh))              // 曾误报 "还有2站"
        XCTAssertNil(BusDisplayReader.arrivalHint(texts: ["在3站台候车"], language: .zh))
        // 真到站信息仍准确读出（整词命中）。
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["5 minutes"], language: .en), "about 5 min")
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["3 mins"], language: .en), "about 3 min")
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["4 stops"], language: .en), "4 stops away")
        // 月台杂讯与真到站同现：跳过站台、命中真的"3站"。
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["2站台", "还有3站"], language: .zh), "还有3站")
    }
}
