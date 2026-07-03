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
    /// 容量满时**隔点抽稀已存轨迹**再继续记录（保首点=回程终点、保末端=回程起步段），而非静默停录——
    /// 停录会把**最近**走过的一段（恰是回程最先要走的）整段丢失，用户毫不知情。backtrackWaypoints
    /// 本就按 25m 抽稀使用，8m 存储粒度是 3 倍过采样：旧段变粗（16m/32m…）不影响回程可用性。
    /// 默认 8m × 2000 点 ≈ 16km；每次抽稀覆盖里程翻倍，超长行程也永不停录。
    @discardableResult
    public mutating func record(lat: Double, lon: Double) -> Bool {
        guard lat.isFinite, lon.isFinite else { return false }
        if let last = points.last {
            let d = Geo.distanceMeters(fromLat: last.lat, fromLon: last.lon, toLat: lat, toLon: lon)
            guard d >= minStepMeters else { return false }
        }
        while points.count >= maxPoints, points.count >= 3 {
            let lastIdx = points.count - 1
            points = points.enumerated().filter { $0.offset % 2 == 0 || $0.offset == lastIdx }.map(\.element)
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
