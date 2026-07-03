import Foundation

/// 自定义路线（路线库）的偏航重新汇入判定——本功能的安全不变量：
/// 人工踩好的路线是**经过验证的安全路径**，偏航时绝不交给自动重规划（会把盲人引上未验证的路），
/// 而是指向最近的**前方**（≥ 当前目标索引）航点，引导其汇回原路线。
public enum RouteRejoin {
    /// 返回应改指的航点索引；nil = 前方没有可达航点（调用方应播报"请原路返回"而非乱指）。
    /// - Parameters:
    ///   - currentIndex: 当前目标航点索引（只考虑 ≥ 它的航点——不往回引，也天然防"抄近道跳过整段路线"：
    ///     取的是**最近**前方航点，不是最远）。
    ///   - maxRejoinMeters: 汇入半径上限；所有前方航点都远于它时返回 nil（默认 150m，
    ///     与 OffRouteDetector 的偏航阈值同数量级，太远的"汇入"实际是让盲人横穿未知区域）。
    public static func rejoinIndex(lat: Double, lon: Double,
                                   waypoints: [Coordinate], currentIndex: Int,
                                   maxRejoinMeters: Double = 150) -> Int? {
        // 非有限输入：无从判定，交调用方走"原路返回"播报（不猜）。
        guard lat.isFinite, lon.isFinite, maxRejoinMeters.isFinite, maxRejoinMeters > 0 else { return nil }
        guard !waypoints.isEmpty else { return nil }
        let start = max(0, min(currentIndex, waypoints.count - 1))
        var best: (index: Int, dist: Double)?
        for i in start..<waypoints.count {
            let w = waypoints[i]
            guard w.lat.isFinite, w.lon.isFinite else { continue } // 坏航点跳过，不毒化选择
            let d = Geo.distanceMeters(fromLat: lat, fromLon: lon, toLat: w.lat, toLon: w.lon)
            guard d.isFinite, d <= maxRejoinMeters else { continue }
            if best == nil || d < best!.dist { best = (i, d) }
        }
        return best?.index
    }
}
