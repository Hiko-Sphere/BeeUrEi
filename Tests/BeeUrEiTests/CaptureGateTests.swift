import XCTest
import CoreVideo
@testable import BeeUrEi

/// OCR 拍摄质量门接线：合成真实 420f 亮度平面 → lumaStats 适配层 → CaptureExposure → captureGate 决策。
/// 门决策错的后果：反光/晃动时拍下必糊帧，OCR 失败盲人却不自知只能反复重拍；反向过拦=烦扰。
final class CaptureGateTests: XCTestCase {

    /// 合成 420f 缓冲：亮度平面按闭包逐像素填充（0-255）。
    private func buffer(w: Int = 64, h: Int = 64, luma: (Int, Int) -> UInt8) -> CVPixelBuffer {
        var b: CVPixelBuffer?
        CVPixelBufferCreate(nil, w, h, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, nil, &b)
        let buf = b!
        CVPixelBufferLockBaseAddress(buf, [])
        let base = CVPixelBufferGetBaseAddressOfPlane(buf, 0)!.assumingMemoryBound(to: UInt8.self)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(buf, 0)
        for y in 0..<h { for x in 0..<w { base[y * stride + x] = luma(x, y) } }
        CVPixelBufferUnlockBaseAddress(buf, [])
        return buf
    }

    func testDarkFrameStats() {
        let stats = FramingAssistViewModel.lumaStats(from: buffer { _, _ in 10 })!
        XCTAssertLessThan(stats.mean, 0.12)
        XCTAssertEqual(CaptureExposure().assess(meanLuminance: stats.mean, brightClippedFraction: stats.clipped, contrast: stats.contrast), .tooDark)
    }

    func testGlareFrameStatsAndBlock() {
        // 一半纯白（反光溢出）一半正常 → clipped≈0.5 > 0.20 → glare → 拦 + 指导换角度。
        let stats = FramingAssistViewModel.lumaStats(from: buffer { x, _ in x < 32 ? 255 : 128 })!
        XCTAssertGreaterThan(stats.clipped, 0.2)
        let q = CaptureExposure().assess(meanLuminance: stats.mean, brightClippedFraction: stats.clipped, contrast: stats.contrast)
        XCTAssertEqual(q, .glare)
        let d = FramingAssistViewModel.captureGate(quality: q, steadiness: .steady)
        XCTAssertEqual(d, .blockExposure(.glare))
        XCTAssertTrue(d.blocks)
    }

    func testFlatGrayAdvisesButProceeds() {
        // 全画面同灰（对比≈0）→ lowContrast → 提醒但放行（宁多试不多拦）。
        let stats = FramingAssistViewModel.lumaStats(from: buffer { _, _ in 128 })!
        XCTAssertLessThan(stats.contrast, 0.08)
        let q = CaptureExposure().assess(meanLuminance: stats.mean, brightClippedFraction: stats.clipped, contrast: stats.contrast)
        XCTAssertEqual(q, .lowContrast)
        let d = FramingAssistViewModel.captureGate(quality: q, steadiness: .steady)
        XCTAssertEqual(d, .advise(.lowContrast))
        XCTAssertFalse(d.blocks)
    }

    func testGoodContrastProceedsSilently() {
        // 黑白条纹（高对比、无溢出、亮度中等）→ ok → 静默放行。
        let stats = FramingAssistViewModel.lumaStats(from: buffer { x, _ in x % 16 < 8 ? 40 : 200 })!
        let q = CaptureExposure().assess(meanLuminance: stats.mean, brightClippedFraction: stats.clipped, contrast: stats.contrast)
        XCTAssertEqual(q, .ok)
        XCTAssertEqual(FramingAssistViewModel.captureGate(quality: q, steadiness: .steady), .proceed)
    }

    func testSteadinessGating() {
        // moving → 拦（拿稳指导），且优先于曝光问题（动着拍什么都糊）。
        XCTAssertEqual(FramingAssistViewModel.captureGate(quality: .glare, steadiness: .moving), .blockSteady)
        // settling（快稳了）与 nil（无运动数据：模拟器/受限，fail-open）都放行。
        XCTAssertEqual(FramingAssistViewModel.captureGate(quality: .ok, steadiness: .settling), .proceed)
        XCTAssertEqual(FramingAssistViewModel.captureGate(quality: .ok, steadiness: nil), .proceed)
        // tooDark 由 LightMeter 路径先处理（本门放行防双报）。
        XCTAssertEqual(FramingAssistViewModel.captureGate(quality: .tooDark, steadiness: .steady), .proceed)
    }

    func testAdviceStringsBilingual() {
        XCTAssertEqual(FramingStrings.holdSteady(.zh), "请拿稳手机，停稳后再试一次")
        let en = FramingStrings.holdSteady(.en)
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
        // 决策→建议文案接线：blockSteady 念拿稳；advise/blockExposure 念核心曝光建议。
        let exp = CaptureExposure()
        XCTAssertEqual(FramingAssistViewModel.CaptureGateDecision.blockSteady.speakAdvice(exposure: exp, lang: .zh),
                       FramingStrings.holdSteady(.zh))
        XCTAssertEqual(FramingAssistViewModel.CaptureGateDecision.advise(.lowContrast).speakAdvice(exposure: exp, lang: .zh),
                       exp.advice(.lowContrast, language: .zh))
        XCTAssertNil(FramingAssistViewModel.CaptureGateDecision.proceed.speakAdvice(exposure: exp, lang: .zh))
    }
}
