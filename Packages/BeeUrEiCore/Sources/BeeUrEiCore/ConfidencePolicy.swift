import Foundation

/// 识别播报置信度门限（纯逻辑，可单测）。对标 P2 痛点"AI 幻觉 + 验证负担"：
/// 竞品把低置信结果说得像权威（厕所标识读反等羞辱性错误），盲人无从核验。
/// BeeUrEi 的产品哲学是"少说但说对"：低置信不说死，播报带"可能"，把不确定性交还给用户。
public struct ConfidencePolicy: Sendable {
    public let confidentThreshold: Float

    public init(confidentThreshold: Float = 0.6) {
        self.confidentThreshold = confidentThreshold
    }

    /// 达到门限才允许用确定语气（"这是X"）；否则播报应带"可能"。非有限值一律不确定。
    public func isConfident(_ confidence: Float) -> Bool {
        confidence.isFinite && confidence >= confidentThreshold
    }
}
