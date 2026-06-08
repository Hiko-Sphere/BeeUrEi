import Foundation

/// 取景引导（纯逻辑，可单测）：盲人不知镜头对着哪——根据目标在画面中的位置/大小，
/// 指引把目标移到画面中央并占满，便于识别物体/读文档/找门牌（竞品最弱、ROI 最高的差异化）。
public enum FramingGuidance: Equatable, Sendable {
    case searching   // 没找到目标
    case moveLeft
    case moveRight
    case moveUp
    case moveDown
    case moveCloser  // 居中但太小/太远
    case centered    // 对准了
}

public struct FramingGuide: Sendable {
    public let centerTolerance: Double // 偏离中心多少才提示调整
    public let minFillRatio: Double    // 目标占画面面积下限（太小=太远）

    public init(centerTolerance: Double = 0.15, minFillRatio: Double = 0.12) {
        self.centerTolerance = centerTolerance
        self.minFillRatio = minFillRatio
    }

    /// target：整帧归一化检测框（原点左上）。nil 表示未检测到目标。
    public func guide(target: NormalizedBox?) -> FramingGuidance {
        guard let t = target else { return .searching }
        let dx = t.midX - 0.5
        let dy = t.midY - 0.5
        // 先纠正偏移更大的一轴（一次只给一个方向，降低认知负荷）。
        if abs(dx) >= abs(dy) {
            if dx < -centerTolerance { return .moveLeft }
            if dx > centerTolerance { return .moveRight }
        } else {
            if dy < -centerTolerance { return .moveUp }
            if dy > centerTolerance { return .moveDown }
        }
        // 已居中：检查大小。
        if t.width * t.height < minFillRatio { return .moveCloser }
        return .centered
    }

    public func hint(_ g: FramingGuidance) -> String {
        switch g {
        case .searching: return "正在寻找目标，请慢慢移动手机"
        case .moveLeft: return "向左移动"
        case .moveRight: return "向右移动"
        case .moveUp: return "向上移动"
        case .moveDown: return "向下移动"
        case .moveCloser: return "靠近一点"
        case .centered: return "对准了，保持不动"
        }
    }
}
