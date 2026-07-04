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
    }

    func testNoLabelOrNoDateReturnsNil() {
        // 有日期但无标签（如单独一行日期/年份）→ 不猜（避免把随意数字当日期）。
        XCTAssertNil(LabelDateReader.find(texts: ["2026.07.15"], language: .zh))
        // 有标签但无日期样式（如"保质期 12个月"）→ 不猜（12个月是时长不是日期）。
        XCTAssertNil(LabelDateReader.find(texts: ["保质期 12个月"], language: .zh))
        // 纯噪声/条码/流水号（无标签）→ nil。
        XCTAssertNil(LabelDateReader.find(texts: ["6901234567890", "1234.5678.9012"], language: .zh))
        XCTAssertNil(LabelDateReader.find(texts: [], language: .zh))
    }

    func testYearMustBePlausible() {
        // 4 位数但非 19/20 开头（如流水号 "1234.56"）即便同行有"exp"也不当日期（年份门控）。
        XCTAssertNil(LabelDateReader.find(texts: ["ref 1234.56 exp code"], language: .en))
        // 真日期 20xx 通过。
        XCTAssertNotNil(LabelDateReader.find(texts: ["use by 2026-08"], language: .en))
    }

    func testDedupAndCap() {
        // OCR 常重复同一行：去重。
        let r = LabelDateReader.find(texts: ["保质期 2026.07.15", "保质期 2026.07.15"], language: .zh)!
        XCTAssertEqual(r.components(separatedBy: "2026.07.15").count - 1, 1) // 只出现一次
    }
}
