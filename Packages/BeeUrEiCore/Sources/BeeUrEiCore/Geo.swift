import Foundation

/// 地理计算（见 docs/PLAN.md §5.3 导航）。纯数学，可单测。
public enum Geo {

    /// 两经纬度点间的初始方位角（度，0=正北，顺时针 0...360）。
    public static func initialBearing(fromLat: Double, fromLon: Double,
                                      toLat: Double, toLon: Double) -> Double {
        let phi1 = fromLat * .pi / 180
        let phi2 = toLat * .pi / 180
        let dLon = (toLon - fromLon) * .pi / 180
        let y = sin(dLon) * cos(phi2)
        let x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dLon)
        var theta = atan2(y, x) * 180 / .pi
        theta = theta.truncatingRemainder(dividingBy: 360)
        return theta < 0 ? theta + 360 : theta
    }

    /// 两点间大圆距离（米，haversine）。
    public static func distanceMeters(fromLat: Double, fromLon: Double,
                                      toLat: Double, toLon: Double) -> Double {
        let radius = 6_371_000.0
        let phi1 = fromLat * .pi / 180
        let phi2 = toLat * .pi / 180
        let dPhi = (toLat - fromLat) * .pi / 180
        let dLon = (toLon - fromLon) * .pi / 180
        let a = sin(dPhi / 2) * sin(dPhi / 2)
              + cos(phi1) * cos(phi2) * sin(dLon / 2) * sin(dLon / 2)
        return radius * 2 * atan2(sqrt(a), sqrt(1 - a))
    }
}
