import Foundation

/// OCR 识别可信度门（纯逻辑，可单测）：朗读识别到的文字时，若整体置信度偏低，**如实追加"识别可能不准确、
/// 建议再拍一次"**——盲人看不到画面，把糊字/生僻字误读当真去按（药品剂量/门牌/地址）后果严重，宁可多提醒。
///
/// 与拍摄质量门（CaptureSteadiness/Exposure）互补、非冗余：那层挡**拍摄前**的抖动/反光/太暗；本层是
/// **识别后**的兜底——即便拍得清晰，褪色小票、手写、生僻字体仍会低置信度识别成错字，唯有 Vision 的
/// 逐行置信度能捕捉。只**追加提醒、绝不丢弃或改写**识别文本（少读不如读全+提醒，让用户自己判断）。
///
/// 判据（两路取或，任一命中即提示）：
/// - 平均置信度 < lowMeanBelow：整体读得心虚。
/// - **任一行** < anyVeryLowBelow：即便均值尚可，个别关键行（可能正是剂量/号码那行）极低也须提醒。
/// 空输入/无有效置信度 → 不提示（没文字就没有"可能读错"一说）。阈值保守缺省，真机标定后可调。
public struct OCRConfidenceGate: Sendable {
    public let lowMeanBelow: Double     // 平均置信度低于此 → 提示不确定
    public let anyVeryLowBelow: Double  // 任一行置信度低于此 → 也提示

    public init(lowMeanBelow: Double = 0.42, anyVeryLowBelow: Double = 0.25) {
        self.lowMeanBelow = lowMeanBelow
        self.anyVeryLowBelow = anyVeryLowBelow
    }

    /// lineConfidences：各识别行的置信度（Vision VNRecognizedText.confidence，0...1）。
    public func isUncertain(lineConfidences: [Float]) -> Bool {
        let valid = lineConfidences.filter { $0.isFinite && $0 >= 0 }
        guard !valid.isEmpty else { return false } // 无有效置信度（无文字/坏数据）→ 不提示
        if valid.contains(where: { Double($0) < anyVeryLowBelow }) { return true }
        let mean = Double(valid.reduce(0, +)) / Double(valid.count)
        return mean < lowMeanBelow
    }

    /// 把不确定提醒追加到识别文本之后（纯函数）：可信 → 原样；不确定 → 文本 +"（识别可能不准确，建议再拍一次）"。
    public func annotate(_ text: String, lineConfidences: [Float], language: Language = .zh) -> String {
        guard !text.isEmpty, isUncertain(lineConfidences: lineConfidences) else { return text }
        let caveat = language == .zh ? "（识别可能不准确，建议再拍一次）" : " (recognition may be inaccurate — try photographing again)"
        return text + caveat
    }
}
