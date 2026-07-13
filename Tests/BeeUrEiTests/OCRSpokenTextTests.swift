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

    // MARK: 读日期（保质期/生产日期）也走置信兜底——与 readText / 读整页姊妹对齐

    func testSpokenDatesLowConfidenceAppendsCaveat() {
        // 药品/食品保质期是最安全攸关的 OCR：糊字低置信误读（2023→2028）＝吃过期。低置信须带"可能不准确、建议再拍一次"。
        let r = FramingAssistViewModel.spokenDates(texts: ["保质期至 2026-06"], lineConfidences: [0.2], language: .zh)
        XCTAssertNotNil(r)
        XCTAssertTrue(r!.pure.contains("2026-06"))           // 纯日期（复制/历史）
        XCTAssertFalse(r!.pure.contains("识别可能不准确"))     // 复制/历史不含提醒
        XCTAssertTrue(r!.spoken.contains("2026-06"))          // 朗读串含日期
        XCTAssertTrue(r!.spoken.contains("识别可能不准确"))    // 且低置信带提醒
    }

    func testSpokenDatesHighConfidenceNoCaveat() {
        let r = FramingAssistViewModel.spokenDates(texts: ["保质期至 2026-06"], lineConfidences: [0.95], language: .zh)
        XCTAssertNotNil(r)
        XCTAssertEqual(r!.spoken, r!.pure)                    // 高置信：朗读串=纯日期，无提醒
        XCTAssertFalse(r!.spoken.contains("识别可能不准确"))
    }

    func testSpokenDatesNoDateReturnsNil() {
        // 无日期标签/样式的行 → nil（不猜），调用方走"没找到日期"。
        XCTAssertNil(FramingAssistViewModel.spokenDates(texts: ["随便一行普通字"], lineConfidences: [0.2], language: .zh))
    }

    // MARK: 读整页多嗓音分段（中文界面读英文文件不再全程被中文嗓念成乱码）

    func testDocSegmentsMixedLanguageSplitsThreeWays() {
        // 中文界面 + 英文正文 → 三段：zh 前缀 / en 正文 / zh 后缀，各配对应嗓音。
        let segs = FramingAssistViewModel.docPageSpeechSegments(
            prefix: "第 1 页读完：", body: "This agreement is made between the parties hereto.", hint: "翻到下一页后再次拍摄。",
            appLang: .zh)
        guard segs.count == 3 else { return XCTFail("应拆三段，实际 \(segs.count) 段") } // guard 防回归时下标越界崩掉整个测试进程
        XCTAssertEqual(segs[0].text, "第 1 页读完：")
        XCTAssertEqual(segs[0].voice, Language.zh.voiceCode)
        XCTAssertEqual(segs[1].voice, Language.en.voiceCode)  // 正文用英文嗓音（核心诉求）
        XCTAssertEqual(segs[2].voice, Language.zh.voiceCode)
    }

    func testDocSegmentsSameLanguageMergesToOne() {
        // 正文与界面同语言 → 合并单段（与旧行为一致：一次 utterance，无段间停顿）。
        let segs = FramingAssistViewModel.docPageSpeechSegments(
            prefix: "第 2 页读完：", body: "本协议由双方共同签署，自签署之日起生效。", hint: "翻到下一页后再次拍摄。",
            appLang: .zh)
        XCTAssertEqual(segs.count, 1)
        XCTAssertEqual(segs[0].text, "第 2 页读完：本协议由双方共同签署，自签署之日起生效。翻到下一页后再次拍摄。")
        XCTAssertEqual(segs[0].voice, Language.zh.voiceCode)
        // 英文界面 + 英文正文同理合并。
        let en = FramingAssistViewModel.docPageSpeechSegments(
            prefix: "Page 1 done: ", body: "This is an English document.", hint: " Turn the page.", appLang: .en)
        XCTAssertEqual(en.count, 1)
        XCTAssertEqual(en[0].voice, Language.en.voiceCode)
    }

    func testDocSegmentsDropsEmptyParts() {
        // 空前缀/后缀不产生空段（空 utterance 会让合成器空转）。
        let segs = FramingAssistViewModel.docPageSpeechSegments(
            prefix: "", body: "English body only.", hint: "", appLang: .zh)
        XCTAssertEqual(segs.count, 1)
        XCTAssertEqual(segs[0].text, "English body only.")
        XCTAssertEqual(segs[0].voice, Language.en.voiceCode)
    }
}
