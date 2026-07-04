import Foundation

/// 一个经纬度坐标。
public struct Coordinate: Sendable, Equatable, Codable {
    public let lat: Double
    public let lon: Double
    public init(lat: Double, lon: Double) {
        self.lat = lat
        self.lon = lon
    }
}

/// 偏航检测（导航重规划，见 docs/PLAN.md §5.3）：当前点偏离路线折线超过阈值 → 判定偏航。
/// 用局部平面近似把经纬度转米，计算点到各折线段的最近距离。
public struct OffRouteDetector: Sendable {
    public let thresholdMeters: Double

    public init(thresholdMeters: Double = 25) {
        self.thresholdMeters = thresholdMeters
    }

    /// 当前点到路线折线的最近距离（米）。空路线返回 nil；非有限坐标（坏 GPS 帧）也返回 nil。
    ///
    /// ⚠️ 必须先挡非有限坐标：NaN/±inf 的 lat 会让 `pointToSegmentMeters` 每段返回 NaN，而
    /// `min(.greatestFiniteMagnitude, NaN)` 在 Swift 里返回**有限的**第一参数 → `best` 停在
    /// `.greatestFiniteMagnitude`（1.8e308），`isOffRoute` 里 `1.8e308 > 25` 为 true → **坏 GPS 帧
    /// 被误判偏航、触发乱重规划/"请回到路线"**（盲人只靠语音、看不出自己其实在路上，被引离正确路线极危险）。
    /// 且单点路线走 Geo（NaN→isOffRoute false）与多点路线（→误判 true）不一致。全库对非有限经纬度一律
    /// "未知不动作"（RouteRejoin/BreadcrumbTrail/WaypointAdvance 均有 isFinite 守卫），此处补齐同一不变量。
    public func distanceToRoute(lat: Double, lon: Double, route: [Coordinate]) -> Double? {
        guard lat.isFinite, lon.isFinite else { return nil }
        guard !route.isEmpty else { return nil }
        if route.count == 1 {
            return Geo.distanceMeters(fromLat: lat, fromLon: lon, toLat: route[0].lat, toLon: route[0].lon)
        }
        var best = Double.greatestFiniteMagnitude
        for i in 0..<(route.count - 1) {
            best = min(best, pointToSegmentMeters(lat: lat, lon: lon, a: route[i], b: route[i + 1]))
        }
        return best
    }

    public func isOffRoute(lat: Double, lon: Double, route: [Coordinate]) -> Bool {
        guard let d = distanceToRoute(lat: lat, lon: lon, route: route) else { return false }
        return d > thresholdMeters
    }

    private func pointToSegmentMeters(lat: Double, lon: Double, a: Coordinate, b: Coordinate) -> Double {
        let mPerDegLat = 111_320.0
        let cosLat = cos(lat * .pi / 180)
        func xy(_ c: Coordinate) -> (Double, Double) {
            // 经度差归一化到 [-180,180]，正确处理反子午线(±180°)跨越，
            // 否则相邻两点会被当成相差近 360°，把在线点误判为偏航。
            var dLon = c.lon - lon
            dLon -= 360 * (dLon / 360).rounded()
            return (dLon * mPerDegLat * cosLat, (c.lat - lat) * mPerDegLat)
        }
        let (ax, ay) = xy(a)
        let (bx, by) = xy(b)
        let dx = bx - ax, dy = by - ay
        let segLenSq = dx * dx + dy * dy
        if segLenSq == 0 { return (ax * ax + ay * ay).squareRoot() }
        var t = -(ax * dx + ay * dy) / segLenSq   // 原点(=当前点)在线段上的投影参数
        t = min(max(t, 0), 1)
        let cx = ax + t * dx, cy = ay + t * dy
        return (cx * cx + cy * cy).squareRoot()
    }
}
