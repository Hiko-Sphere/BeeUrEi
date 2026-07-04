import XCTest
@testable import BeeUrEiCore

/// 人民币面额判定：双信号置信、单信号降级、冲突放弃、序列号/年号免疫。
final class CurrencyClassifierTests: XCTestCase {
    let c = CurrencyClassifier()

    // 第五套人民币代表色（0...1 RGB）
    let red100 = (r: 0.75, g: 0.25, b: 0.25)   // 100 元 红
    let green50 = (r: 0.35, g: 0.6, b: 0.4)    // 50 元 绿
    let blue10 = (r: 0.3, g: 0.45, b: 0.65)    // 10 元 蓝
    let gray = (r: 0.5, g: 0.5, b: 0.5)        // 低饱和：无颜色信号

    func testDigitsPlusMatchingHueIsConfident() {
        let r = c.classify(texts: ["100", "中国人民银行", "100"], rgb: red100)
        XCTAssertEqual(r, .init(denomination: 100, confident: true))
    }

    func testSingleDigitWithoutColorIsUncertain() {
        let r = c.classify(texts: ["100"], rgb: nil)
        XCTAssertEqual(r, .init(denomination: 100, confident: false))
    }

    func testRepeatedDigitsWithoutColorIsConfident() {
        // 票面角号多处印面额：≥2 处一致即较可靠
        let r = c.classify(texts: ["100", "100"], rgb: nil)
        XCTAssertEqual(r, .init(denomination: 100, confident: true))
    }

    func testHueMismatchDowngradesToUncertain() {
        let r = c.classify(texts: ["100", "100"], rgb: green50)
        XCTAssertEqual(r, .init(denomination: 100, confident: false))
    }

    func testLowSaturationCountsAsNoColorSignal() {
        let r = c.classify(texts: ["10", "10"], rgb: gray)
        XCTAssertEqual(r, .init(denomination: 10, confident: true))
    }

    func testCapitalChineseTokens() {
        XCTAssertEqual(c.classify(texts: ["壹佰圆"], rgb: red100),
                       .init(denomination: 100, confident: true))
        // "伍拾圆"含子串"拾圆"，必须判 50 而不是 10
        XCTAssertEqual(c.classify(texts: ["伍拾圆"], rgb: green50),
                       .init(denomination: 50, confident: true))
        XCTAssertEqual(c.classify(texts: ["贰拾圆"], rgb: nil)?.denomination, 20)
        XCTAssertEqual(c.classify(texts: ["拾圆"], rgb: blue10),
                       .init(denomination: 10, confident: true))
    }

    func testSerialNumbersAndYearsDoNotVote() {
        // 年号 2015、冠字序列号里的数字串都不是独立面额
        XCTAssertNil(c.classify(texts: ["2015年", "FA09286771"], rgb: red100))
        // "100" 里不能拆出 "10"
        let r = c.classify(texts: ["100"], rgb: blue10)
        XCTAssertEqual(r?.denomination, 100)
    }

    func testTieBrokenByHueIsUncertain() {
        // 同帧扫到两张不同面额：主色只支持其一 → 取它但只说"可能"
        let r = c.classify(texts: ["100", "50"], rgb: green50)
        XCTAssertEqual(r, .init(denomination: 50, confident: false))
    }

    func testTieWithoutColorGivesUp() {
        XCTAssertNil(c.classify(texts: ["100", "50"], rgb: nil))
        XCTAssertNil(c.classify(texts: ["100", "50"], rgb: gray))
    }

    func testNoDenominationTextReturnsNil() {
        XCTAssertNil(c.classify(texts: [], rgb: red100))
        XCTAssertNil(c.classify(texts: ["中国人民银行"], rgb: red100)) // 纯颜色不猜
    }

    func testStandaloneNumberExtraction() {
        XCTAssertEqual(CurrencyClassifier.standaloneAmounts(in: "No.100 元 2015").map(\.value), [100, 2015])
        XCTAssertTrue(CurrencyClassifier.standaloneAmounts(in: "abc").isEmpty)
        // "5角"的 5 被标记为 jiao（不投给 5 元）。
        let amts = CurrencyClassifier.standaloneAmounts(in: "5角")
        XCTAssertEqual(amts.count, 1); XCTAssertEqual(amts[0].value, 5); XCTAssertTrue(amts[0].jiao)
    }
}

// 角面额防 10 倍误报（对盲人是严重的钱数错误）——2026-07 补。
extension CurrencyClassifierTests {
    func testJiaoNotMisreadAsYuan() {
        let c = CurrencyClassifier()
        // "5角"绝不再报成 5 元：报 jiao=true。
        let r = c.classify(texts: ["5角"], rgb: nil)
        XCTAssertEqual(r?.denomination, 5); XCTAssertEqual(r?.jiao, true)
        // 扫两次也不会"确信 5 元"——是确信 5 角。
        let r2 = c.classify(texts: ["5角", "5角"], rgb: nil)
        XCTAssertEqual(r2?.denomination, 5); XCTAssertEqual(r2?.jiao, true)
        // 大写"伍角"识别为 5 角。
        let r3 = c.classify(texts: ["伍角"], rgb: nil)
        XCTAssertEqual(r3?.denomination, 5); XCTAssertEqual(r3?.jiao, true)
        // 壹角。
        XCTAssertEqual(c.classify(texts: ["1角"], rgb: nil)?.jiao, true)
    }

    /// OCR 常把票面"5角"拆成"5 角"（中间掺空格）。紧邻判据会漏成 5 元（10 倍误报）——这里必须仍判 5 角。
    func testSpaceSeparatedJiaoStillJiao() {
        let c = CurrencyClassifier()
        let amts = CurrencyClassifier.standaloneAmounts(in: "5 角")
        XCTAssertEqual(amts.count, 1); XCTAssertEqual(amts[0].value, 5); XCTAssertTrue(amts[0].jiao)
        let r = c.classify(texts: ["5 角"], rgb: nil)
        XCTAssertEqual(r?.denomination, 5); XCTAssertEqual(r?.jiao, true)
        // 中间掺标点同理（如"5·角"）。
        XCTAssertTrue(CurrencyClassifier.standaloneAmounts(in: "1 角").first?.jiao == true)
    }

    /// 小数金额 "0.5"（0.5 元 = 5 角）：绝不能把小数位的 "5" 当独立面额投给"5 元"（10 倍误报）。
    /// 无单位信号时宁可不猜（返回 nil），也不谎报。
    func testDecimalFractionNotVotedAsYuan() {
        let c = CurrencyClassifier()
        XCTAssertFalse(CurrencyClassifier.standaloneAmounts(in: "0.5").contains { $0.value == 5 })
        XCTAssertNil(c.classify(texts: ["0.5"], rgb: nil))
        // "12.50" 的 "50" 是小数位，不能投成 50 元。
        XCTAssertFalse(CurrencyClassifier.standaloneAmounts(in: "12.50").contains { $0.value == 50 })
        // 但冠字号 "No.100" 的点前是字母，100 仍要正常投票（回归护栏）。
        XCTAssertTrue(CurrencyClassifier.standaloneAmounts(in: "No.100").contains { $0.value == 100 })
    }

    func testYuanUnaffectedByJiaoChange() {
        let c = CurrencyClassifier()
        // 真 5 元（伍圆 + 角号 5）仍是 5 元、jiao=false。
        let r = c.classify(texts: ["伍圆", "5"], rgb: nil)
        XCTAssertEqual(r?.denomination, 5); XCTAssertEqual(r?.jiao, false)
        // 100 元不受影响。
        XCTAssertEqual(c.classify(texts: ["壹佰圆", "100"], rgb: nil)?.denomination, 100)
        XCTAssertEqual(c.classify(texts: ["壹佰圆"], rgb: nil)?.jiao, false)
    }
}
