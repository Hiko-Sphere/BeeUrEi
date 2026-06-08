import Foundation

/// 光线评估（纯逻辑，可单测）：盲人看不见环境明暗，暗处识别/OCR 易失败却不知原因。
/// 由 iOS 适配层算画面平均亮度(luminance 0...1)传入。
public struct LightMeter: Sendable {
    public enum Level: Sendable { case dark, dim, ok }

    public let darkThreshold: Double
    public let dimThreshold: Double

    public init(darkThreshold: Double = 0.15, dimThreshold: Double = 0.3) {
        self.darkThreshold = darkThreshold
        self.dimThreshold = dimThreshold
    }

    public func level(brightness: Double) -> Level {
        if brightness < darkThreshold { return .dark }
        if brightness < dimThreshold { return .dim }
        return .ok
    }

    public func warning(brightness: Double) -> String? {
        switch level(brightness: brightness) {
        case .dark: return "光线太暗，可能看不清，请到亮一点的地方再试"
        case .dim:  return "光线较暗，识别可能不准"
        case .ok:   return nil
        }
    }

    /// Rec.601 亮度。
    public static func luminance(r: Double, g: Double, b: Double) -> Double {
        0.299 * r + 0.587 * g + 0.114 * b
    }
}
