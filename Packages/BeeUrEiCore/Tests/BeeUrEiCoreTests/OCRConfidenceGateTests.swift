import XCTest
@testable import BeeUrEiCore

/// OCR 可信度门：低置信度朗读须如实带"可能不准确"。漏报（把误读当真读给盲人）后果严重，
/// 误报（对清晰文本乱加提醒）钝化信任——故均值/单行/空输入边界从严。
final class OCRConfidenceGateTests: XCTestCase {
    private let gate = OCRConfidenceGate() // lowMean=0.42, anyVeryLow=0.25

    func testHighConfidenceNotUncertain() {
        XCTAssertFalse(gate.isUncertain(lineConfidences: [0.9, 0.85, 0.95]))
    }

    func testLowMeanFlagsUncertain() {
        // 整体读得心虚（均值 0.35 < 0.42）。
        XCTAssertTrue(gate.isUncertain(lineConfidences: [0.4, 0.3, 0.35]))
    }

    func testAnySingleVeryLowFlagsEvenIfMeanOk() {
        // 均值尚可（(0.9+0.9+0.2)/3=0.667）但个别行极低(0.2<0.25)——那行可能正是剂量/号码 → 提示。
        XCTAssertTrue(gate.isUncertain(lineConfidences: [0.9, 0.9, 0.2]))
    }

    func testEmptyOrInvalidNeverFlags() {
        // 无文字/无有效置信度 → 不提示（没文字就没有"可能读错"）。
        XCTAssertFalse(gate.isUncertain(lineConfidences: []))
        XCTAssertFalse(gate.isUncertain(lineConfidences: [.nan, -1]))  // 坏值滤除后为空
    }

    func testBoundaryValues() {
        // 均值明确高于阈值 → 不提示（0.42 恰界因 Float→Double 精度不可靠，用 0.45 明确高于）。
        XCTAssertFalse(gate.isUncertain(lineConfidences: [0.45, 0.45]))
        // 单行 0.25 恰界（0.25 在二进制浮点可精确表示，0.25 不 < 0.25）→ 不提示；均值 0.575 也 ok。
        XCTAssertFalse(gate.isUncertain(lineConfidences: [0.9, 0.25]))
        // 略低于阈值即提示（0.24 < 0.25）。
        XCTAssertTrue(gate.isUncertain(lineConfidences: [0.9, 0.24]))
    }

    func testAnnotateAppendsCaveatOnlyWhenUncertain() {
        // 可信 → 原样；不确定 → 追加提醒（不改写/不丢弃原文）。
        XCTAssertEqual(gate.annotate("阿司匹林 100mg", lineConfidences: [0.9], language: .zh), "阿司匹林 100mg")
        XCTAssertEqual(gate.annotate("阿司匹林 100mg", lineConfidences: [0.2], language: .zh),
                       "阿司匹林 100mg（识别可能不准确，建议再拍一次）")
        // 空文本不加提醒（"没识别到文字"另有分支）。
        XCTAssertEqual(gate.annotate("", lineConfidences: [0.2], language: .zh), "")
        // 英文纯净。
        let en = gate.annotate("Aspirin", lineConfidences: [0.2], language: .en)
        XCTAssertTrue(en.contains("inaccurate"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }
}
