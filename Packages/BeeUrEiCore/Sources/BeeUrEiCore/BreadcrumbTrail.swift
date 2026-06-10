import Foundation

/// 面包屑轨迹（Soundscape 式回程）：行进中记录 GPS 航点，一键反向原路返回。
/// 「进得去出不来」是盲人在陌生场所最大的焦虑——记路把回程风险移到出发时。
/// 纯逻辑可单测；录制去抖（与上点距离 ≥ minStepMeters 才记）防止原地抖动灌满轨迹。
public struct BreadcrumbTrail: Sendable {
    public private(set) var points: [Coordinate] = []
    private let minStepMeters: Double
    private let maxPoints: Int

    public init(minStepMeters: Double = 8, maxPoints: Int = 2000) {
        self.minStepMeters = minStepMeters
        self.maxPoints = maxPoints
    }

    public var count: Int { points.count }
    /// 起点（回程的终点）。
    public var start: Coordinate? { points.first }

    /// 记录一个定位点。仅当与上一点距离 ≥ minStepMeters 时入轨（返回 true）。
    /// 超过 maxPoints 后不再记录（8m 步距 × 2000 点 ≈ 16km，足够步行场景）。
    @discardableResult
    public mutating func record(lat: Double, lon: Double) -> Bool {
        guard lat.isFinite, lon.isFinite else { return false }
        guard points.count < maxPoints else { return false }
        if let last = points.last {
            let d = Geo.distanceMeters(fromLat: last.lat, fromLon: last.lon, toLat: lat, toLon: lon)
            guard d >= minStepMeters else { return false }
        }
        points.append(Coordinate(lat: lat, lon: lon))
        return true
    }

    /// 回程航点：轨迹反向 + 按 minSpacingMeters 抽稀（信标引导为主，航点不必密）。
    /// 始终包含**原始起点**（它是回程的终点/到达判定点）。
    public func backtrackWaypoints(minSpacingMeters: Double = 25) -> [Coordinate] {
        guard points.count >= 2 else { return points.reversed() }
        let reversed = Array(points.reversed())
        var out: [Coordinate] = []
        var lastKept: Coordinate?
        for p in reversed {
            if let k = lastKept {
                let d = Geo.distanceMeters(fromLat: k.lat, fromLon: k.lon, toLat: p.lat, toLon: p.lon)
                guard d >= minSpacingMeters else { continue }
            }
            out.append(p)
            lastKept = p
        }
        // 确保原始起点（reversed 的最后一个）在列表末尾。
        if let origin = reversed.last, out.last != origin { out.append(origin) }
        return out
    }

    public mutating func reset() { points = [] }
}
