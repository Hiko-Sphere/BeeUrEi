import Foundation

/// 多障碍危险度排序：在一帧里有多个障碍时，决定先播报哪个。
/// 危险度 = 近距 + 越正前方 + 高危类别加成（见 docs/PLAN.md §5.1/§5.8）。
public struct ObstacleRanker: Sendable {
    public let catalog: HazardCatalog

    public init(catalog: HazardCatalog = HazardCatalog()) {
        self.catalog = catalog
    }

    /// 危险度评分，越大越危险。
    public func dangerScore(_ o: Obstacle) -> Double {
        // 距离项：越近越大（1m→1.0, 0.5m→2.0），上限封顶；未知距离给中等保守值。
        let distanceScore: Double
        if let d = o.distanceMeters, d > 0 {
            // 用 1/max(d, ε) 而非硬封顶 10.0，保证最危险的近区(<0.1m)仍严格单调（越近分越高）。
            distanceScore = 1.0 / max(d, 0.001)
        } else {
            distanceScore = 1.0
        }
        // 居中项：越接近正前方分越高（0°→1, ±90°→0）。
        let centrality = max(0, 1 - abs(o.clock.angleDegrees) / 90)
        // 高危类别加成。
        let hazardBoost = catalog.isHighRisk(o.label) ? 1.5 : 1.0
        return (distanceScore + centrality) * hazardBoost
    }

    /// 最危险的障碍（空数组返回 nil）。
    public func mostDangerous(_ obstacles: [Obstacle]) -> Obstacle? {
        obstacles.max { dangerScore($0) < dangerScore($1) }
    }

    /// 按危险度降序排序。
    public func ranked(_ obstacles: [Obstacle]) -> [Obstacle] {
        obstacles.sorted { dangerScore($0) > dangerScore($1) }
    }
}
