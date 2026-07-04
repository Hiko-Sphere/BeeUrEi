import XCTest
@testable import BeeUrEiCore

/// OCR 曝光质量：正常/太暗/反光/低对比判定、优先级、坏输入 fail-open、双语建议。
final class CaptureExposureTests: XCTestCase {
    let e = CaptureExposure()

    func testOkFrame() {
        XCTAssertEqual(e.assess(meanLuminance: 0.5, brightClippedFraction: 0.02, contrast: 0.4), .ok)
        XCTAssertNil(e.advice(.ok))
    }

    func testTooDark() {
        XCTAssertEqual(e.assess(meanLuminance: 0.05, brightClippedFraction: 0.0, contrast: 0.2), .tooDark)
        XCTAssertTrue(e.advice(.tooDark)!.contains("暗"))
        XCTAssertTrue(e.advice(.tooDark, language: .en)!.lowercased().contains("dark"))
    }

    func testGlareFromClippedHighlights() {
        // 平均亮度正常但大片高光溢出（玻璃标签反光）→ 反光。
        XCTAssertEqual(e.assess(meanLuminance: 0.55, brightClippedFraction: 0.35, contrast: 0.5), .glare)
        XCTAssertTrue(e.advice(.glare, language: .en)!.lowercased().contains("glare"))
    }

    func testLowContrast() {
        // 不暗不反光但画面发平（褪色小票）→ 低对比。
        XCTAssertEqual(e.assess(meanLuminance: 0.5, brightClippedFraction: 0.01, contrast: 0.03), .lowContrast)
    }

    func testPriorityGlareOverOthers() {
        // 反光优先：即便对比也偏低，大片高光先报反光（更可操作）。
        XCTAssertEqual(e.assess(meanLuminance: 0.6, brightClippedFraction: 0.3, contrast: 0.05), .glare)
        // 太暗优先于低对比：暗帧常同时低对比，先报"加光"这条可执行的。
        XCTAssertEqual(e.assess(meanLuminance: 0.05, brightClippedFraction: 0.0, contrast: 0.02), .tooDark)
    }

    func testBadInputFailsOpenToOk() {
        // 坏传感数据不反复拦住拍照。
        XCTAssertEqual(e.assess(meanLuminance: .nan, brightClippedFraction: 0.5, contrast: 0.5), .ok)
        XCTAssertEqual(e.assess(meanLuminance: 0.5, brightClippedFraction: .infinity, contrast: 0.5), .ok)
        // 越界输入被夹取而非误判：brightClipped 1.5 视作 1.0（>阈值）→ 仍报反光。
        XCTAssertEqual(e.assess(meanLuminance: 0.5, brightClippedFraction: 1.5, contrast: 0.5), .glare)
    }

    func testConfigurableThresholds() {
        let strict = CaptureExposure(darkMeanBelow: 0.3, glareClippedAbove: 0.5, lowContrastBelow: 0.2)
        XCTAssertEqual(strict.assess(meanLuminance: 0.25, brightClippedFraction: 0.0, contrast: 0.5), .tooDark) // 0.25<0.3
        XCTAssertEqual(strict.assess(meanLuminance: 0.5, brightClippedFraction: 0.3, contrast: 0.5), .ok)       // 0.3<0.5 不算反光
    }
}
