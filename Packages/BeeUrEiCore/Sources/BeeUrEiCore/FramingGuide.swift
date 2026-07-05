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
        // 坏检测框（NaN/∞——退化帧/除零归一化）：绝不能落到 .centered 谎报"对准了、可以拍"。所有方向/大小判定
        // 遇 NaN 都为 false → 会一路穿到 .centered，让盲人对着无效画面按下快门。视作没检到目标、继续引导（同
        // CompassRose/LightMeter 等的坏数据守卫；此模块曾漏）。
        guard t.midX.isFinite, t.midY.isFinite, t.width.isFinite, t.height.isFinite else { return .searching }
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

    public func hint(_ g: FramingGuidance, language: Language = .zh) -> String {
        switch g {
        case .searching: return SpokenStrings.framingSearching(language)
        case .moveLeft: return SpokenStrings.framingMoveLeft(language)
        case .moveRight: return SpokenStrings.framingMoveRight(language)
        case .moveUp: return SpokenStrings.framingMoveUp(language)
        case .moveDown: return SpokenStrings.framingMoveDown(language)
        case .moveCloser: return SpokenStrings.framingMoveCloser(language)
        case .centered: return SpokenStrings.framingCentered(language)
        }
    }
}
