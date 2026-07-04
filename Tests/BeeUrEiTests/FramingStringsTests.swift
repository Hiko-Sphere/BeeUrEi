import XCTest
@testable import BeeUrEi

/// 识别屏播报文案表（E5 多语言）：中文与历史一致、英文不串中文、组合短语正确。
final class FramingStringsTests: XCTestCase {

    func testProductAllergensSpeakOnlyPresenceNeverAbsence() {
        // 已知过敏原走本地化表；未知不丢弃（连字符转空格原词读出，丢了会造成"只含这些"的假完整）。
        XCTAssertEqual(FramingStrings.allergenDisplay("peanuts", .zh), "花生")
        XCTAssertEqual(FramingStrings.allergenDisplay("sulphur-dioxide-and-sulphites", .zh), "二氧化硫及亚硫酸盐")
        XCTAssertEqual(FramingStrings.allergenDisplay("some-rare-thing", .zh), "some rare thing") // 未知：原词读出
        XCTAssertEqual(FramingStrings.allergenDisplay("soybeans", .en), "soy")
        // 组句：报"标注含有"，一次拼接（.query 替换语义）；空 = nil，**绝不**生成"不含过敏原"（缺数据≠不含）。
        let zh = FramingStrings.productAllergensSpeak(["peanuts", "milk"], .zh)
        XCTAssertEqual(zh, "。包装标注含有：花生、牛奶")
        XCTAssertNil(FramingStrings.productAllergensSpeak([], .zh))
        let en = FramingStrings.productAllergensSpeak(["wheat"], .en)!
        XCTAssertTrue(en.contains("Label lists allergens: wheat"))
        XCTAssertFalse(en.lowercased().contains("no allergen")) // 永不播"不含"
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    func testTorchAutoOnTellsUserItWasSolved() {
        // 太暗自动点灯的播报：须点明已打开手电筒 + 提示重试（而非只说"太暗"卡住）。
        let zh = FramingStrings.torchAutoOn(.zh)
        XCTAssertTrue(zh.contains("手电筒") && (zh.contains("太暗") || zh.contains("暗")))
        let en = FramingStrings.torchAutoOn(.en)
        XCTAssertTrue(en.lowercased().contains("flashlight") && en.lowercased().contains("dark"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

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

    func testUIChromeLocalized() {
        XCTAssertEqual(FramingStrings.uiTitle(.banknote, .zh), "识别纸币")
        XCTAssertEqual(FramingStrings.uiTitle(.banknote, .en), "Banknote")
        XCTAssertEqual(FramingStrings.uiTitle(.stopFind, .en), "Stop Finding")
        XCTAssertEqual(FramingStrings.uiFindItem("钥匙", .zh), "找：钥匙")
        XCTAssertEqual(FramingStrings.uiFindNearby("chair", .en), "Find nearby chair")
        // 全部 UI 动作中英标题/hint 非空
        let actions: [FramingStrings.UIAction] = [.whatsAhead, .readText, .fullPage, .light, .color,
                                                  .scan, .explore, .banknote, .people, .find, .stopFind, .bus]
        for a in actions {
            for l in [Language.zh, .en] {
                XCTAssertFalse(FramingStrings.uiTitle(a, l).isEmpty)
                XCTAssertFalse(FramingStrings.uiHint(a, l).isEmpty)
            }
        }
        // 历史滑动操作的无障碍名（VoiceOver 靠它念"复制/删除"，而非 SF Symbol 名）。
        XCTAssertEqual(FramingStrings.uiCopy(.zh), "复制内容")
        XCTAssertEqual(FramingStrings.uiDelete(.zh), "删除")
        XCTAssertEqual(FramingStrings.uiDelete(.en), "Delete")
    }

    func testLowConfidencePhrases() {
        XCTAssertEqual(FramingStrings.maybeThis("椅子", .zh), "可能是椅子")
        XCTAssertEqual(FramingStrings.recognizedMaybeResult("chair", .en), "Possibly: chair")
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

    func testContinuousModeToggleTitles() {
        // 光/色连续模式按钮标题随开关态切换，且英文不混中文。
        XCTAssertEqual(FramingStrings.lightToneTitle(false, .zh), FramingStrings.uiTitle(.light, .zh)) // 关态=原标题
        XCTAssertTrue(FramingStrings.lightToneTitle(true, .zh).contains("关闭"))
        XCTAssertEqual(FramingStrings.colorContinuousTitle(false, .zh), FramingStrings.uiTitle(.color, .zh))
        XCTAssertTrue(FramingStrings.colorContinuousTitle(true, .zh).contains("关闭"))
        for s in [FramingStrings.lightToneTitle(true, .en), FramingStrings.colorContinuousTitle(true, .en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文混中文：\(s)")
        }
    }

    func testSeatOccupancySuffixes() {
        // 占用后缀作为句尾追加（找空座位）：措辞保守（"可能"而非断言）；英文无中文混入。
        XCTAssertEqual(FramingStrings.seatLooksFree(.zh), "，看起来空着")
        XCTAssertTrue(FramingStrings.seatMaybeOccupied(.zh).contains("可能"))
        XCTAssertFalse(FramingStrings.seatLooksFree(.en).contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
        // 拼接形态与实际播报一致（"椅子，在3 点钟方向，大约1.5 米，可能有人"）
        let joined = FramingStrings.foundCategorySpeak("椅子", "3 点钟方向", FramingStrings.approx(1.5, .zh), .zh) + FramingStrings.seatMaybeOccupied(.zh)
        XCTAssertEqual(joined, "椅子，在3 点钟方向，大约1.5 米，可能有人")
    }
}
