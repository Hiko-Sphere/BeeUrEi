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

    func testGeoNavigationURLStartsWalkingDirectionsNotJustPin() {
        // 位置码「导航」须真正开始**步行方向**（daddr+dirflg=w），而非 ?ll= 只落一个图钉——
        // 盲人用 VoiceOver 再手动找"路线"极难，等于没导航（与聊天位置气泡 openInMaps 步行模式同取向）。
        let url = FramingStrings.geoNavigationURL(31.2304, 121.4737)
        XCTAssertTrue(url.hasPrefix("https://maps.apple.com/"), url)
        XCTAssertTrue(url.contains("daddr=31.2304,121.4737"), url) // 目的地=精确坐标（不按地名重搜）
        XCTAssertTrue(url.contains("dirflg=w"), url)               // 步行模式
        XCTAssertFalse(url.contains("?ll="), url)                  // 不是"只显示图钉"的旧 center 参数
    }

    func testProductDietaryLabelsSpeakLabeledNotJudged() {
        // 膳食/宗教认证标注（盲人看不到包装认证：乳糜泻/乳糖不耐/素食/宗教/糖尿病刚需）。canonical key → 本地化名。
        let zh = FramingStrings.productDietaryLabelsSpeak(["gluten-free", "vegan", "halal"], .zh)
        XCTAssertEqual(zh, "。包装标注：无麸质、纯素、清真")
        // 措辞是"标注"（如实转述包装认证），**绝不**替用户断言"适合你/安全食用"。
        XCTAssertFalse(zh!.contains("适合") && !zh!.contains("标注"))
        XCTAssertNil(FramingStrings.productDietaryLabelsSpeak([], .zh)) // 空=无数据→nil（缺数据≠不符/不含）
        let en = FramingStrings.productDietaryLabelsSpeak(["lactose-free", "kosher"], .en)!
        XCTAssertTrue(en.contains("Labeled: lactose-free, kosher"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } })) // 英文不混中文
        // 未知 key 不丢弃（连字符转空格原样读，避免"只这些"的假完整）。
        XCTAssertTrue(FramingStrings.productDietaryLabelsSpeak(["some-new-cert"], .en)!.contains("some new cert"))
    }

    func testCashCountingFormatting() {
        // 运行总额：分→元/角，张数在前（帮用户核对漏扫/多扫）。150 元 5 角。
        XCTAssertEqual(FramingStrings.cashTotal(totalFen: 15050, count: 3, .zh), "共 3 张，150 元 5 角")
        XCTAssertEqual(FramingStrings.cashTotal(totalFen: 15000, count: 3, .zh), "共 3 张，150 元") // 无角不赘述
        let en = FramingStrings.cashTotal(totalFen: 15050, count: 1, .en)
        XCTAssertEqual(en, "1 note, 150 yuan 5 jiao") // 单数 note 不带 s
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
        // 逐张播报：加 + 运行总额。
        let added = FramingStrings.cashAdded("五十元", totalFen: 5000, count: 1, .zh)
        XCTAssertTrue(added.contains("加 五十元"))
        XCTAssertTrue(added.contains("共 1 张，50 元"))
        // 撤销：非空报新总额、空则回清零措辞。
        XCTAssertTrue(FramingStrings.cashUndone(totalFen: 5000, count: 1, .zh).contains("已撤销上一张"))
        XCTAssertTrue(FramingStrings.cashUndone(totalFen: 0, count: 0, .zh).contains("清零"))
    }

    func testProductNutrientLevelsSpeakWarnsHighOnlyNeverReassures() {
        // 逐营养素"偏高"警示（对标 Yuka 红标；糖尿病/高血压/控脂刚需）。只警示 high、固定顺序（糖→盐→饱和脂肪→脂肪）。
        let zh = FramingStrings.productNutrientLevelsSpeak(["sugars": "high", "salt": "high", "fat": "low"], .zh)
        XCTAssertEqual(zh, "。含量偏高：糖、盐") // fat=low 不播；顺序固定：糖在盐前
        let en = FramingStrings.productNutrientLevelsSpeak(["saturated-fat": "high", "sugars": "high"], .en)!
        XCTAssertEqual(en, ". High in: sugar, saturated fat") // 固定顺序：糖(sugars)先于饱和脂肪
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } })) // 英文不混中文
        // **绝不**播 low/moderate（不说"不高/含量适中"——避免假安心，同过敏原"缺数据≠不含"口径）。
        XCTAssertNil(FramingStrings.productNutrientLevelsSpeak(["sugars": "low", "salt": "moderate", "fat": "moderate"], .zh))
        XCTAssertNil(FramingStrings.productNutrientLevelsSpeak([:], .zh)) // 无数据→nil
        XCTAssertNil(FramingStrings.productNutrientLevelsSpeak(["energy": "high"], .en)) // 白名单外的素不认（不该出现，防御）
    }

    func testProductQuantitySpeakVerbatimSuffix() {
        // 净含量后缀拼在商品名后（"这是X，500 ml"）：原样读、不换算单位；空/纯空白→nil（缺数据不硬凑）。
        XCTAssertEqual(FramingStrings.productQuantitySpeak("500 ml", .zh), "，500 ml")
        XCTAssertEqual(FramingStrings.productQuantitySpeak("200 g", .en), ", 200 g")
        XCTAssertEqual(FramingStrings.productQuantitySpeak("500毫升", .zh), "，500毫升") // 中文单位原样
        XCTAssertNil(FramingStrings.productQuantitySpeak(nil, .zh))
        XCTAssertNil(FramingStrings.productQuantitySpeak("", .zh))
        XCTAssertNil(FramingStrings.productQuantitySpeak("   ", .zh))
        // 端到端拼接：名字 + 净含量后缀读作"这是蒙牛纯牛奶，500 ml"。
        XCTAssertEqual(FramingStrings.thisIs("蒙牛纯牛奶", .zh) + (FramingStrings.productQuantitySpeak("500 ml", .zh) ?? ""), "这是蒙牛纯牛奶，500 ml")
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
            FramingStrings.findStartTaught("keys", .en),
            FramingStrings.wifiSpeak(WifiCredential(ssid: "Home", password: "pw", security: "WPA", hidden: false), .en),
        ]
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }

    func testWifiSurfacesPassword() {
        // 扫 Wi-Fi 码的关键是密码（盲人看不到贴纸上的密码）：结果与播报都须含网络名 + 密码，且转义字符原样。
        let wpa = WifiCredential(ssid: "Cafe5G", password: "s3cret;pw", security: "WPA", hidden: false)
        XCTAssertEqual(FramingStrings.wifiResult(wpa, .zh), "无线网络码：Cafe5G，密码：s3cret;pw")
        XCTAssertTrue(FramingStrings.wifiSpeak(wpa, .zh).contains("密码是 s3cret;pw"), FramingStrings.wifiSpeak(wpa, .zh))
        XCTAssertTrue(FramingStrings.wifiResult(wpa, .en).contains("password: s3cret;pw"))
        XCTAssertTrue(FramingStrings.wifiSpeak(wpa, .en).contains("password s3cret;pw"))
        // 开放网络：明确"无密码"，不谎报有密码。
        let open = WifiCredential(ssid: "FreeWiFi", password: nil, security: "nopass", hidden: false)
        XCTAssertTrue(FramingStrings.wifiResult(open, .zh).contains("开放网络"))
        XCTAssertFalse(FramingStrings.wifiResult(open, .zh).contains("密码："))
        // 畸形（nil 凭据）退化为通用词，不崩。
        XCTAssertEqual(FramingStrings.wifiResult(nil, .zh), "无线网络码")
        // 端到端：从 WIFI: 原文解析到播报，密码贯通（parseWifi 已单测转义，这里验管线拼接）。
        let cred = BarcodePayload.parseWifi("WIFI:T:WPA;S:MyNet;P:pa\\;ss;;")
        XCTAssertEqual(cred?.password, "pa;ss")
        XCTAssertTrue(FramingStrings.wifiResult(cred, .zh).contains("密码：pa;ss"))
    }

    func testSmsSurfacesBody() {
        // 扫短信码：号码 + **预填正文**都读出（不报正文=盲人不知会发出什么，订阅/付费短信可乘虚而入）。
        XCTAssertEqual(FramingStrings.smsResult("10086", "余额查询", .zh), "短信：10086，内容：余额查询")
        XCTAssertTrue(FramingStrings.smsSpeak("10086", "余额查询", .zh).contains("内容：余额查询"))
        XCTAssertTrue(FramingStrings.smsSpeak("10086", "balance", .en).lowercased().contains("message: balance"))
        // 无正文：只报号码，不拼空"内容"。
        XCTAssertEqual(FramingStrings.smsResult("10086", nil, .zh), "短信：10086")
        XCTAssertFalse(FramingStrings.smsSpeak("10086", nil, .zh).contains("内容"))
        // 端到端：从 SMSTO: 原文解析到播报，正文贯通。
        if case let .sms(number, body) = BarcodePayload.classify("SMSTO:10086:余额查询") {
            XCTAssertEqual(number, "10086")
            XCTAssertTrue(FramingStrings.smsSpeak(number, body, .zh).contains("内容：余额查询"))
        } else { XCTFail("SMSTO 应分类为 .sms") }
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

    func testJiaoNamesNeverSpokenAsYuan() {
        // 角面额渲染（识币防 10 倍钱数错的**最后一米**）：五角/两角/一角，且**绝不**含"元/yuan"——否则 5 角被念成
        // 5 元，盲人多付 10 倍（CurrencyClassifier 已在分类侧防此，rendering 侧此前无测，补齐端到端守卫）。
        XCTAssertEqual(FramingStrings.yuan(5, jiao: true, .zh), "五角")
        XCTAssertEqual(FramingStrings.yuan(2, jiao: true, .zh), "两角")
        XCTAssertEqual(FramingStrings.yuan(1, jiao: true, .zh), "一角")
        for d in [1, 2, 5] { // 分类侧白名单（CurrencyClassifier.jiaoDenoms）1/2/5：逐一核对渲染
            XCTAssertTrue(FramingStrings.yuan(d, jiao: true, .zh).hasSuffix("角"), "\(d) 角中文须以角结尾")
            XCTAssertFalse(FramingStrings.yuan(d, jiao: true, .zh).contains("元"), "\(d) 角中文绝不含元（=10 倍钱数错）")
            let en = FramingStrings.yuan(d, jiao: true, .en)
            XCTAssertTrue(en.contains("jiao"), "\(d) 角英文须含 jiao：\(en)")
            XCTAssertFalse(en.contains("yuan"), "\(d) 角英文绝不含 yuan（=10 倍钱数错）：\(en)")
        }
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

    func testCalendarEventStrings() {
        // 标题+时间都有：读"日程事件：标题，时间"，播报附"请核对"。
        XCTAssertEqual(FramingStrings.calendarEventResult(title: "产品发布会", start: "2026-07-20 14:00", .zh),
                       "日程事件：产品发布会，2026-07-20 14:00")
        XCTAssertTrue(FramingStrings.calendarEventSpeak(title: "产品发布会", start: "2026-07-20 14:00", .zh).contains("请核对"))
        XCTAssertEqual(FramingStrings.calendarEventResult(title: "Launch", start: "2026-07-20", .en),
                       "Calendar event: Launch, 2026-07-20")
        // 缺标题/时间：省略对应片段（不留悬空标点）。
        XCTAssertEqual(FramingStrings.calendarEventResult(title: nil, start: nil, .zh), "日程事件")
        XCTAssertEqual(FramingStrings.calendarEventResult(title: "会议", start: nil, .zh), "日程事件：会议")
        // 英文不混中文。
        XCTAssertFalse(FramingStrings.calendarEventSpeak(title: "Launch", start: "2026-07-20", .en)
            .contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }
}
