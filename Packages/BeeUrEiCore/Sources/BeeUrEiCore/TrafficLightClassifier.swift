import Foundation

public enum TrafficLightState: String, Sendable, Equatable {
    case red, yellow, green, unknown
}

/// 红绿灯颜色判别（核心、可单测）：给定灯区平均 RGB(0...1) → 红/黄/绿/未知。
/// iOS 适配层负责从检测到的红绿灯 bbox 采样平均色（YCbCr→RGB）后调用。
/// ⚠️ 远距/小目标/眩光下不可靠，正式应配合专用模型；这里是启发式 + 安全偏保守。
public struct TrafficLightClassifier: Sendable {
    public init() {}

    public func classify(r: Double, g: Double, b: Double) -> TrafficLightState {
        // 非有限通道（曝光归一化除零/溢出算出 ∞、空 bbox 取平均得 NaN）：**绝不**分类，一律 .unknown。
        // 生命攸关：如 g=∞ 会让「g>0.42 且 g-r>0.10」成立 → 误判**绿灯**、叫盲人过马路（致命假绿）。全 NaN 靠
        // max 语义恰好落到 .unknown，但 ∞ 会穿过"太暗"门后触发误判——显式守卫最稳，且不依赖 max 的 NaN 序。
        guard r.isFinite, g.isFinite, b.isFinite else { return .unknown }
        guard max(r, max(g, b)) > 0.22 else { return .unknown } // 太暗
        // 黄：红绿都亮、蓝低。
        if r > 0.5 && g > 0.4 && b < 0.45 && abs(r - g) < 0.22 { return .yellow }
        // 红：红明显高于绿/蓝。
        if r > 0.45 && r - g > 0.15 && r - b > 0.12 { return .red }
        // 绿：绿明显高于红。
        if g > 0.42 && g - r > 0.10 { return .green }
        return .unknown
    }

    /// 过街提示语（安全偏保守：非绿一律“请等待”；语言可选，默认中文）。
    public func hint(_ state: TrafficLightState, language: Language = .zh) -> String? {
        switch state {
        case .green: return SpokenStrings.trafficGreen(language)
        case .red: return SpokenStrings.trafficRed(language)
        case .yellow: return SpokenStrings.trafficYellow(language)
        case .unknown: return nil
        }
    }
}
