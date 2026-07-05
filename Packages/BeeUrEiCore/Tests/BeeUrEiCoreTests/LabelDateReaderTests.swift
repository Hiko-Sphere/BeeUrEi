import XCTest
@testable import BeeUrEiCore

/// 包装日期识别：关键字+日期样式门控、原样surface、去重、无标签/无日期不猜、双语。
final class LabelDateReaderTests: XCTestCase {
    func testSurfacesLabeledDateVerbatim() {
        let r = LabelDateReader.find(texts: ["某某牌饼干", "保质期至 2026.07.15", "净含量 200g"], language: .zh)
        XCTAssertNotNil(r)
        XCTAssertTrue(r!.contains("保质期至 2026.07.15"))
        XCTAssertTrue(r!.contains("请核对")) // 始终附核对提醒
        XCTAssertFalse(r!.contains("过期")) // 绝不判是否过期
    }

    func testMultipleDateLabelsBothSurfaced() {
        // 生产日期 + 保质期都读出（不判谁是过期日，交给用户）。
        let r = LabelDateReader.find(texts: ["生产日期 2026.01.15", "保质期 2027年01月14日"], language: .zh)!
        XCTAssertTrue(r.contains("生产日期 2026.01.15"))
        XCTAssertTrue(r.contains("2027年01月14日"))
    }

    func testEnglishLabels() {
        let r = LabelDateReader.find(texts: ["BEST BEFORE 15/07/2026"], language: .en)!
        XCTAssertTrue(r.contains("BEST BEFORE 15/07/2026"))
        XCTAssertTrue(r.lowercased().contains("verify"))
        let r2 = LabelDateReader.find(texts: ["EXP 07/2026"], language: .en)!
        XCTAssertTrue(r2.contains("EXP 07/2026"))
        // 新增标签：shelf life（=保质期）、expiration（美式常见有效期）——此前完全不识别。
        XCTAssertTrue(LabelDateReader.find(texts: ["shelf life until 2026-12"], language: .en)!.contains("2026-12"))
        XCTAssertTrue(LabelDateReader.find(texts: ["expiration date 12/2026"], language: .en)!.contains("12/2026"))
    }

    func testNoLabelOrNoDateReturnsNil() {
        // 有日期但无标签（如单独一行日期/年份）→ 不猜（避免把随意数字当日期）。
        XCTAssertNil(LabelDateReader.find(texts: ["2026.07.15"], language: .zh))
        // 有**时长**但无标签（如单独一行"12个月"/运输时效）→ 不猜（时长须与保质/有效标签同行才 surface）。
        XCTAssertNil(LabelDateReader.find(texts: ["12个月"], language: .zh))
        XCTAssertNil(LabelDateReader.find(texts: ["运输时效 3天"], language: .zh))       // 非保质类标签
        XCTAssertNil(LabelDateReader.find(texts: ["保修期 24个月"], language: .zh))      // 保修≠保质，非日期标签
        // 有标签但既无日期样式也无时长（如"保质期见瓶身"）→ 不猜。
        XCTAssertNil(LabelDateReader.find(texts: ["保质期见瓶身"], language: .zh))
        // 纯噪声/条码/流水号（无标签）→ nil。
        XCTAssertNil(LabelDateReader.find(texts: ["6901234567890", "1234.5678.9012"], language: .zh))
        XCTAssertNil(LabelDateReader.find(texts: [], language: .zh))
    }

    func testSurfacesShelfLifeDurationVerbatim() {
        // 中文食品药品包装主流写法：保质期/有效期为**时长**（原样读出，仍不做任何日期运算、仍附"请核对"）。
        let r = LabelDateReader.find(texts: ["生产日期 2026.07.31", "保质期 12个月"], language: .zh)!
        XCTAssertTrue(r.contains("生产日期 2026.07.31"))  // 生产日期
        XCTAssertTrue(r.contains("保质期 12个月"))          // 保质时长——此前被整支丢弃
        XCTAssertTrue(r.contains("请核对"))
        XCTAssertFalse(r.contains("过期"))                  // 绝不判是否过期
        // 只印时长（生产日期不在扫到的行里）也读出，别让盲人一无所获。
        XCTAssertTrue(LabelDateReader.find(texts: ["有效期 24个月"], language: .zh)!.contains("24个月"))
        XCTAssertTrue(LabelDateReader.find(texts: ["保质期 360天"], language: .zh)!.contains("360天"))
        XCTAssertTrue(LabelDateReader.find(texts: ["保质期 3年"], language: .zh)!.contains("3年"))
        // 英文时长（须有 shelf life / best before 等标签）。
        XCTAssertTrue(LabelDateReader.find(texts: ["shelf life 18 months"], language: .en)!.contains("18 months"))
        XCTAssertTrue(LabelDateReader.find(texts: ["best before 720 days from production"], language: .en)!.contains("720 days"))
    }

    func testYearMustBePlausible() {
        // 4 位数但非 19/20 开头（如流水号 "1234.56"）即便同行有"exp"也不当日期（年份门控）。
        XCTAssertNil(LabelDateReader.find(texts: ["ref 1234.56 exp code"], language: .en))
        // 真日期 20xx 通过。
        XCTAssertNotNil(LabelDateReader.find(texts: ["use by 2026-08"], language: .en))
    }

    func testCompactAndSpacedYmdCodes() {
        // 喷码 YYYYMMDD 无分隔（此前完全漏识——食品药品包装最常见的写法）。
        XCTAssertTrue(LabelDateReader.find(texts: ["生产日期20260731"], language: .zh)!.contains("20260731"))
        XCTAssertTrue(LabelDateReader.find(texts: ["有效期至20261231"], language: .zh)!.contains("20261231"))
        XCTAssertTrue(LabelDateReader.find(texts: ["EXP20261130"], language: .en)!.contains("20261130"))
        // 空格分隔 2026 07 31 / 2026 07。
        XCTAssertTrue(LabelDateReader.find(texts: ["保质期 2026 07 31"], language: .zh)!.contains("2026 07 31"))
        XCTAssertTrue(LabelDateReader.find(texts: ["best before 2026 12"], language: .en)!.contains("2026 12"))
    }

    func testCompactCodeDoesNotFalseMatchBarcodesOrSerials() {
        // 数字边界保护：即便同行有日期标签，13 位条码/长流水号里的一段也不当日期（防误读害盲人核对错东西）。
        XCTAssertNil(LabelDateReader.find(texts: ["保质期见喷码 6920260731000"], language: .zh)) // 长串里含 20260731 但被数字边界排除
        XCTAssertNil(LabelDateReader.find(texts: ["exp lot 20260731999"], language: .en))        // 11 位流水号，非日期
        // 年份门控仍在：非 19/20 开头的 8 位数（即便有日期标签）不当日期。
        XCTAssertNil(LabelDateReader.find(texts: ["有效期 18990101"], language: .zh))
    }

    func testEnglishMonthNameDates() {
        // 进口食品/药品最常见的月份名写法（此前纯数字正则完全漏识）。
        XCTAssertTrue(LabelDateReader.find(texts: ["BEST BEFORE JUL 2026"], language: .en)!.contains("BEST BEFORE JUL 2026"))
        XCTAssertTrue(LabelDateReader.find(texts: ["EXP DEC 2025"], language: .en)!.contains("EXP DEC 2025"))
        XCTAssertTrue(LabelDateReader.find(texts: ["use by December 2025"], language: .en)!.contains("December 2025"))
        // 带日：月 日, 年 / 日 月 年 两种顺序。
        XCTAssertTrue(LabelDateReader.find(texts: ["best before Jul 31, 2026"], language: .en)!.contains("Jul 31, 2026"))
        XCTAssertTrue(LabelDateReader.find(texts: ["EXPIRY 31 JUL 2026"], language: .en)!.contains("31 JUL 2026"))
        XCTAssertTrue(LabelDateReader.find(texts: ["use by 31st July 2026"], language: .en)!.contains("31st July 2026"))
        // 大小写不敏感 + 中文标签同英文月名混排也读出。
        XCTAssertTrue(LabelDateReader.find(texts: ["保质期 Aug 2027"], language: .zh)!.contains("Aug 2027"))
    }

    func testMonthNameDoesNotFalseMatchOrdinaryWords() {
        // "MARKET 2026"含"mar"但后面不是"月末+年"结构 → 不误判为日期（有标签也不猜）。
        XCTAssertNil(LabelDateReader.find(texts: ["exp MARKET 2026 lot"], language: .en))
        // "MAY CONTAIN NUTS"：may 后非年份 → 不误配。
        XCTAssertNil(LabelDateReader.find(texts: ["best before MAY CONTAIN NUTS"], language: .en))
        // 月份名后跟的是超长数字串（非 4 位年）→ 不当日期。
        XCTAssertNil(LabelDateReader.find(texts: ["exp JUL 20260731999"], language: .en))
    }

    func testShortLabelExpRequiresWordBoundary() {
        // "exp" 是 export/express/expo 的子串——这些普通词不该把整行误当"有效期日期"读给盲人。
        // （尤其配合月份名识别后，"Express … July 2026" 会同时满足标签+日期两关）。
        XCTAssertNil(LabelDateReader.find(texts: ["Express delivery July 2026"], language: .en))
        XCTAssertNil(LabelDateReader.find(texts: ["Export lot 2026-01"], language: .en))
        XCTAssertNil(LabelDateReader.find(texts: ["Expo 2026-08 hall"], language: .en))
        // 真的 EXP 标签仍识别：带空格、带句点、紧贴喷码日期（EXP20261130）。
        XCTAssertNotNil(LabelDateReader.find(texts: ["EXP 12/2026"], language: .en))
        XCTAssertNotNil(LabelDateReader.find(texts: ["EXP. 2026-08"], language: .en))
        XCTAssertTrue(LabelDateReader.find(texts: ["EXP20261130"], language: .en)!.contains("20261130"))
    }

    func testHyphenSeparatedDates() {
        // 回归：连字符分隔的日期是药品/进口食品包装的**主流写法**，此前只认空格/斜杠/点 → 全漏。
        // 盲人扫药盒读不出有效期是安全红线。数字连字符（日-月-年）：
        XCTAssertTrue(LabelDateReader.find(texts: ["有效期 31-07-2026"], language: .zh)!.contains("31-07-2026"))
        XCTAssertTrue(LabelDateReader.find(texts: ["EXP 15-07-26"], language: .en)!.contains("15-07-26"))
        XCTAssertTrue(LabelDateReader.find(texts: ["保质期 07-2026"], language: .zh)!.contains("07-2026")) // 月-年
        // 月份名连字符（药品最常见 EXP 31-JUL-2026 / DEC-2025 / 蓝色喷码 JUL-2026）：
        XCTAssertTrue(LabelDateReader.find(texts: ["EXP 31-JUL-2026"], language: .en)!.contains("31-JUL-2026"))
        XCTAssertTrue(LabelDateReader.find(texts: ["EXP: DEC-2025"], language: .en)!.contains("DEC-2025"))
        XCTAssertTrue(LabelDateReader.find(texts: ["best before JUL-2026"], language: .en)!.contains("JUL-2026"))
        XCTAssertTrue(LabelDateReader.find(texts: ["use by JUL-31-2026"], language: .en)!.contains("JUL-31-2026"))
        // 门控/边界不因放宽分隔符而失守：非日期串仍不误读，普通含"exp"的词仍不命中。
        XCTAssertNil(LabelDateReader.find(texts: ["exp JUL 20260731999"], language: .en))   // 超长数字串非年
        XCTAssertNil(LabelDateReader.find(texts: ["Export lot 2026-01"], language: .en))     // export 非 exp 标签
    }

    func testMonthTwoDigitYearCodes() {
        // MM/YY 是药品/化妆品有效期的全球主流写法（此前只认 4 位年 → 2 位年全漏，药盒读不出有效期=安全红线）。
        XCTAssertTrue(LabelDateReader.find(texts: ["EXP 07/26"], language: .en)!.contains("07/26"))       // 斜杠
        XCTAssertTrue(LabelDateReader.find(texts: ["EXP 12-26"], language: .en)!.contains("12-26"))       // 连字符（药品喷码）
        XCTAssertTrue(LabelDateReader.find(texts: ["有效期 09.27"], language: .zh)!.contains("09.27"))     // 点分隔 + 中文标签
        // 月锁 01-12：比例/分数（非月）即便同行有日期标签也不误当日期。
        XCTAssertNil(LabelDateReader.find(texts: ["exp mix 50/50 lot"], language: .en))   // 50 非月
        XCTAssertNil(LabelDateReader.find(texts: ["exp 24/7 hotline"], language: .en))    // 24 非月（且 7 单位数）
        XCTAssertNil(LabelDateReader.find(texts: ["exp ratio 16/9 panel"], language: .en)) // 16 非月
        // 数字边界不吃 4 位年 MM/YYYY 的一段、也不吃三段式里的嵌套段（整行仍照常 surface，不受影响）。
        XCTAssertTrue(LabelDateReader.find(texts: ["EXP 07/2026"], language: .en)!.contains("07/2026"))   // 仍是 4 位年整体
        XCTAssertTrue(LabelDateReader.find(texts: ["EXP 15/07/26"], language: .en)!.contains("15/07/26")) // 三段式整体
    }

    func testDedupAndCap() {
        // OCR 常重复同一行：去重。
        let r = LabelDateReader.find(texts: ["保质期 2026.07.15", "保质期 2026.07.15"], language: .zh)!
        XCTAssertEqual(r.components(separatedBy: "2026.07.15").count - 1, 1) // 只出现一次
    }
}
