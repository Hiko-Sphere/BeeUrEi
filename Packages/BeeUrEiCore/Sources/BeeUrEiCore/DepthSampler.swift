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
}
