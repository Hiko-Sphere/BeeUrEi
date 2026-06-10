import XCTest
@testable import BeeUrEi

/// 识别屏播报文案表（E5 多语言）：中文与历史一致、英文不串中文、组合短语正确。
final class FramingStringsTests: XCTestCase {

    func testChineseMatchesLegacyPhrases() {
        // 关键短语与历史播报逐字一致（防止 i18n 改造悄悄改了中文体验）
        XCTAssertEqual(FramingStrings.thisIs("椅子", .zh), "这是椅子")
        XCTAssertEqual(FramingStrings.docIntro(.zh),
                       "读整页模式。把手机举在纸张上方约三十厘米，听提示调整，对好后会自动拍摄并朗读全文。")
        XCTAssertEqual(FramingStrings.noBarcode(.zh), "没有识别到二维码或条码")
        XCTAssertEqual(FramingStrings.banknoteUncertain("一百元", .zh), "可能是一百元，请换个角度再拍一次确认")
        XCTAssertEqual(FramingStrings.stillSearching(.zh), "还在找，慢慢移动手机")
    }

    func testEnglishHasNoChinese() {
        // 英文文案不得混入中文字符（防漏翻）
        let samples = [
            FramingStrings.teachIntro(.en), FramingStrings.docIntro(.en),
            FramingStrings.productUnknownSpeak(.en), FramingStrings.banknoteNone(.en),
            FramingStrings.exploreIntro(objects: 2, texts: 3, .en),
            FramingStrings.findStartTaught("keys", .en), FramingStrings.wifiSpeak("Home", .en),
        ]
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }

    func testBusAndMultiPagePhrases() {
        XCTAssertEqual(FramingStrings.busResult("公交车", "11 点钟方向", "103，开往东站", .zh),
                       "公交车，在11 点钟方向：103，开往东站")
        XCTAssertEqual(FramingStrings.docPageDonePrefix(2, .zh), "第2页识别完成。")
        XCTAssertEqual(FramingStrings.docMultiDoneResult(3, .zh), "读整页结束：共3页，全文已可复制")
        XCTAssertFalse(FramingStrings.busNoText("bus", "ahead", .en).isEmpty)
    }

    func testYuanNames() {
        XCTAssertEqual(FramingStrings.yuan(100, .zh), "一百元")
        XCTAssertEqual(FramingStrings.yuan(5, .zh), "五元")
        XCTAssertEqual(FramingStrings.yuan(100, .en), "100 yuan")
    }

    func testDirectionAndApprox() {
        XCTAssertEqual(FramingStrings.direction(hour: 12, .zh), "正前方")
        XCTAssertEqual(FramingStrings.direction(hour: 3, .zh), "3 点钟方向")
        XCTAssertEqual(FramingStrings.direction(hour: 12, .en), "ahead")
        XCTAssertEqual(FramingStrings.approx(1.5, .zh), "，大约1.5 米")
        XCTAssertEqual(FramingStrings.approx(1.5, .en), ", about 1.5 m")
    }
}
