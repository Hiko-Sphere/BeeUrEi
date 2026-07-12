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

    func testArrivalHintArriveVerbNotNoun() {
        // 回归：英文即将到站信号须是**动词** arriving/arrives/arrive，而非**名词** arrival/arrivals。
        // 站牌标准词 "Arrivals"（表头）、"Next arrival 5 min" 里的 arrival 若被当"即将到站"，会**压掉**
        // 真实的"还有5分钟"读数——盲人被告知"车到了"而实际还有 5 分钟，可能提前迈向路缘（安全攸关）。
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["Next arrival", "5 min"], language: .en), "about 5 min")
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["Arrivals", "3 min"], language: .en), "about 3 min")
        XCTAssertNil(BusDisplayReader.arrivalHint(texts: ["Arrival Hall"], language: .en)) // 纯名词、无数字 → 无到站信号
        // 动词形式仍准确判"即将到站"（不因防名词而漏报真的到站）。
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["Arriving"], language: .en), "arriving now")
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["Bus arrives"], language: .en), "arriving now")
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["Will arrive"], language: .en), "arriving now")
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["Approaching"], language: .en), "arriving now")
    }

    func testChineseAlreadyArrivedIsImminent() {
        // 中文"已到站"（车已抵达）= 即将到站——补齐与英文动词 arrived 对称的信号（此前只认"即将/进站"）。
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["103路", "已到站"], language: .zh), "即将到站")
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["车已到站"], language: .zh), "即将到站")
        // **不**误判名词头"到站时间/到站信息"为即将到站（不含"已"）——否则会把真实读数压成假"车到了"、
        // 让站台上的盲人提前迈向路缘（安全攸关，同英文 arriv(?!al) 防名词）。无到站信号 → nil。
        XCTAssertNil(BusDisplayReader.arrivalHint(texts: ["到站时间", "查询"], language: .zh))
        XCTAssertNil(BusDisplayReader.arrivalHint(texts: ["到站信息"], language: .zh))
        // "到站时间"表头 + 真实"还有3分钟"：报分钟，不被误判即将（"已到站"不匹配"到站时间"）。
        XCTAssertEqual(BusDisplayReader.arrivalHint(texts: ["到站时间", "还有3分钟"], language: .zh), "还有约3分钟")
    }
}
