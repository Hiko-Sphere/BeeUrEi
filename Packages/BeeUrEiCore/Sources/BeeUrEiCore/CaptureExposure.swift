import Foundation

/// OCR 拍摄曝光/对比质量判据（纯逻辑，可单测）。盲人看不见画面，**过曝反光**（玻璃/铜版纸标签在灯下大片
/// 高光溢出，该区域文字全白丢失）与**对比过低**（褪色小票、文字与背景相近）都会悄悄让 OCR 失败却不自知，
/// 只能反复重拍。本模块从画面亮度直方图统计判「能不能读」，给出可执行的调整建议。
///
/// 与 [[LightMeter]] 的分工：LightMeter 是「环境明暗感知」（暗/微暗/正常）；本模块是**拍摄读字前的成片质量
/// 门**，除欠曝外还覆盖过曝/反光与低对比——OCR 专用。二者对「暗」的判定有意重叠（不同阈值/用途），各取所需。
///
/// 输入由 iOS 适配层从（降采样的）画面亮度算出：
/// - meanLuminance：平均亮度 0...1（0 全黑、1 全白）。
/// - brightClippedFraction：接近纯白（≥~0.97）的像素占比 0...1——反光/过曝的直接信号。
/// - contrast：归一化对比度 0...1（如亮度标准差×2 夹到 1）——太低=画面发灰发糊、字缘不清。
public struct CaptureExposure: Sendable {
    public enum Quality: Equatable, Sendable {
        case ok
        case tooDark      // 欠曝：整体太暗——加光/开灯
        case glare        // 过曝反光：大片高光溢出——换角度/避开灯或反光面
        case lowContrast  // 对比过低：褪色/字与底相近——靠近些、或换到光线更均匀处
    }

    public let darkMeanBelow: Double       // 平均亮度低于此 → 太暗
    public let glareClippedAbove: Double   // 纯白像素占比高于此 → 反光/过曝
    public let lowContrastBelow: Double    // 归一化对比度低于此 → 太平

    public init(darkMeanBelow: Double = 0.12, glareClippedAbove: Double = 0.20, lowContrastBelow: Double = 0.08) {
        self.darkMeanBelow = darkMeanBelow
        self.glareClippedAbove = glareClippedAbove
        self.lowContrastBelow = lowContrastBelow
    }

    /// 评估成片质量。坏输入（非有限）**fail-open 返回 .ok**——绝不因坏传感数据反复拦住用户拍照。
    /// 优先级：反光 > 太暗 > 低对比（反光最具体可操作；暗与低对比在暗帧上常并存，先报"加光"这条更可执行的）。
    public func assess(meanLuminance: Double, brightClippedFraction: Double, contrast: Double) -> Quality {
        guard meanLuminance.isFinite, brightClippedFraction.isFinite, contrast.isFinite else { return .ok }
        let mean = min(max(meanLuminance, 0), 1)
        let bright = min(max(brightClippedFraction, 0), 1)
        let contr = max(contrast, 0)
        if bright > glareClippedAbove { return .glare }
        if mean < darkMeanBelow { return .tooDark }
        if contr < lowContrastBelow { return .lowContrast }
        return .ok
    }

    /// 可播报的中/英调整建议；.ok 返回 nil（无需打扰）。
    public func advice(_ q: Quality, language: Language = .zh) -> String? {
        let zh = language == .zh
        switch q {
        case .ok: return nil
        case .tooDark: return zh ? "光线太暗，请开灯或走到亮处" : "Too dark — turn on a light or move to a brighter spot"
        case .glare: return zh ? "有反光，请换个角度或避开灯光" : "Glare detected — change angle or avoid the light"
        case .lowContrast: return zh ? "画面发灰、字不清，靠近些或换均匀光线" : "Low contrast — move closer or find even lighting"
        }
    }
}
