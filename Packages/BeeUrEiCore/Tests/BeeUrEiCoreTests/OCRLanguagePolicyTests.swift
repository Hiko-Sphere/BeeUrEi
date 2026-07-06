import XCTest
@testable import BeeUrEiCore

/// OCR 识别语言优先序：简繁英三者都在，且**繁体中文必须在**（台湾/港澳盲人扫繁体不再乱码）。
final class OCRLanguagePolicyTests: XCTestCase {
    func testIncludesSimplifiedTraditionalAndEnglish() {
        for l in [Language.zh, .en] {
            let langs = OCRLanguagePolicy.recognitionLanguages(interfaceLanguage: l)
            XCTAssertTrue(langs.contains("zh-Hant"), "繁体中文必须在识别语言里（\(l)）")
            XCTAssertTrue(langs.contains("zh-Hans"), "简体中文必须在（\(l)）")
            XCTAssertTrue(langs.contains("en-US"), "英文必须在（\(l)）")
        }
    }

    func testInterfaceLanguageIsPrioritizedFirst() {
        // Vision 用顺序当识别优先：中文界面简中排最前、英文界面英文排最前（但繁中始终在列）。
        XCTAssertEqual(OCRLanguagePolicy.recognitionLanguages(interfaceLanguage: .zh).first, "zh-Hans")
        XCTAssertEqual(OCRLanguagePolicy.recognitionLanguages(interfaceLanguage: .en).first, "en-US")
    }
}
