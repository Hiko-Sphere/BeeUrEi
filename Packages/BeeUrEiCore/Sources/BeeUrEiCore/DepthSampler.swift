import Foundation

/// 障碍接近分级。
public enum ProximityZone: Sendable, Equatable {
    case clear     // 无近距障碍
    case caution   // 中距，提示
    case danger    // 近距，强提示
}

/// LiDAR 深度采样 → 最近障碍距离与分级（见 docs/PLAN.md §5.1/§5.2）。
///
/// 纯逻辑：输入一组深度样本（米，通常取自画面中央 ROI 的若干像素）+ 可选置信度，
/// 过滤无效/低置信像素后取最近距离，并按阈值分级。
/// 这样把「不认识但很近」也能预警——即使分类器没识别出物体（见 §5.8）。
public struct DepthSampler: Sendable {
    public let dangerMeters: Double
    public let cautionMeters: Double
    public let minConfidence: Float
    public let minValidMeters: Double

    public init(dangerMeters: Double = 1.0,
                cautionMeters: Double = 2.5,
                minConfidence: Float = 0.3,
                minValidMeters: Double = 0.1) {
        self.dangerMeters = dangerMeters
        self.cautionMeters = cautionMeters
        self.minConfidence = minConfidence
        self.minValidMeters = minValidMeters
    }

    /// 在深度样本里找最近的有效距离（米）。`confidences` 为 nil 表示不做置信度过滤。
    public func nearestDistance(depths: [Double], confidences: [Float]? = nil) -> Double? {
        var best: Double?
        for (i, d) in depths.enumerated() {
            guard d.isFinite, d >= minValidMeters else { continue }
            // 提供了置信度数组时，缺对应项或低置信的样本一律丢弃——
            // 否则尾部无置信样本会绕过安全门控，被当作有效最近障碍。
            if let c = confidences {
                guard i < c.count, c[i] >= minConfidence else { continue }
            }
            if best == nil || d < best! { best = d }
        }
        return best
    }

    public func zone(forNearest distance: Double?) -> ProximityZone {
        guard let d = distance else { return .clear }
        if d < dangerMeters { return .danger }
        if d < cautionMeters { return .caution }
        return .clear
    }

    public func evaluate(depths: [Double], confidences: [Float]? = nil) -> (nearest: Double?, zone: ProximityZone) {
        let n = nearestDistance(depths: depths, confidences: confidences)
        return (n, zone(forNearest: n))
    }

    /// 是否**确认**前方通畅：必须有有效读数、且最近有效读数在 caution 之外（真·远处空旷）。
    ///
    /// 安全语义（见安全复审「玻璃门假通畅」）：`nearestDistance` 返回最近**有效**样本——
    /// 有效读数为 nil 意味着中央 ROI 零有效样本，即 LiDAR 在正前方**读不到**（玻璃/镜面/透明/
    /// 深色湿滑/超近盲区特征性如此）。此时**绝不**确认通畅：「通畅」须由「读到远处」这一正向证据
    /// 挣得，而非「无数据」默认得到——否则会对恰恰检测不了的近距障碍给出致命假安心。
    /// （代价：正前方超出 LiDAR 量程的开阔空间也读不到 → 不再周期播「通畅」，仅损失安慰、绝不误报。）
    public func isConfirmedClear(depths: [Double], confidences: [Float]? = nil) -> Bool {
        guard let d = nearestDistance(depths: depths, confidences: confidences) else { return false } // 无读数 → 不确认
        return d >= cautionMeters
    }
}
