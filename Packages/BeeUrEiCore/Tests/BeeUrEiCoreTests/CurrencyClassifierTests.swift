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
        XCTAssertEqual(CurrencyClassifier.standaloneNumbers(in: "No.100 元 2015"), [100, 2015])
        XCTAssertEqual(CurrencyClassifier.standaloneNumbers(in: "abc"), [])
    }
}
