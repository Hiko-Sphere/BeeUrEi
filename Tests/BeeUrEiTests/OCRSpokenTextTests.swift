import XCTest
@testable import BeeUrEi

/// 朗读用 OCR 文本合成（三处文本朗读 OCR 共用：识别屏读文字 / 读整页 / 聊天读图）：
/// 低置信度带"识别可能不准确"提醒，且提醒语言随**文本语言**（防英文正文配中文提醒选错嗓音）。
/// 复制/历史存的仍是原纯文本——本函数只产朗读串。
final class OCRSpokenTextTests: XCTestCase {

    private let highConf: [Float] = [0.95, 0.9]
    private let lowConf: [Float] = [0.2]

    func testHighConfidenceReturnsRawUnchanged() {
        XCTAssertEqual(FramingAssistViewModel.ocrSpokenText("阿司匹林 100mg", lineConfidences: highConf), "阿司匹林 100mg")
    }

    func testLowConfidenceChineseTextGetsChineseCaveat() {
        let out = FramingAssistViewModel.ocrSpokenText("阿司匹林 100mg", lineConfidences: lowConf)
        XCTAssertTrue(out.hasPrefix("阿司匹林 100mg"))          // 原文保留在前
        XCTAssertTrue(out.contains("识别可能不准确"))            // 中文正文 → 中文提醒
        XCTAssertFalse(out.contains("inaccurate"))
    }

    func testLowConfidenceEnglishTextGetsEnglishCaveat() {
        // 英文正文 → 英文提醒（不混中文，否则 speakInTextLanguage 会因夹中文而选错嗓音）。
        let out = FramingAssistViewModel.ocrSpokenText("Aspirin 100mg tablets", lineConfidences: lowConf)
        XCTAssertTrue(out.contains("inaccurate"))
        XCTAssertFalse(out.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    func testEmptyStaysEmpty() {
        // 空文本（"没识别到文字"另有分支）→ 不加提醒。
        XCTAssertEqual(FramingAssistViewModel.ocrSpokenText("", lineConfidences: lowConf), "")
    }
}
