import Foundation

/// WGS-84 ↔ GCJ-02 坐标纠偏（国内导航必需）。
/// iPhone GPS 给的是 WGS-84；高德路线/地点全是 GCJ-02（国家测绘加密偏移）。
/// 不转换则定位点相对路线系统性偏移 100–700 米，逐向引导/偏航检测完全不可用。
/// 算法为公开的标准椭球偏移近似（精度 ~1–2m，远小于 GPS 本身误差）；境外坐标原样返回。
public enum ChinaCoord {
    /// WGS-84 → GCJ-02（把 GPS 定位换算到高德坐标系）。
    public static func wgs84ToGcj02(lat: Double, lon: Double) -> (lat: Double, lon: Double) {
        guard isInChina(lat: lat, lon: lon) else { return (lat, lon) }
        let (dLat, dLon) = delta(lat: lat, lon: lon)
        return (lat + dLat, lon + dLon)
    }

    /// GCJ-02 → WGS-84（一次迭代精化逆变换，误差降到厘米级）。
    public static func gcj02ToWgs84(lat: Double, lon: Double) -> (lat: Double, lon: Double) {
        guard isInChina(lat: lat, lon: lon) else { return (lat, lon) }
        // 初值：反减一次 delta；再用正变换的残差修正一次（标准迭代逆）。
        var wLat = lat, wLon = lon
        for _ in 0..<2 {
            let g = wgs84ToGcj02(lat: wLat, lon: wLon)
            wLat -= g.lat - lat
            wLon -= g.lon - lon
        }
        return (wLat, wLon)
    }

    /// 粗判是否在中国大陆范围（GCJ 偏移仅在境内生效；港澳台/境外不偏移）。
    public static func isInChina(lat: Double, lon: Double) -> Bool {
        // 大陆粗包络；剔除明显境外。边界处 GPS 精度远大于纠偏误差，粗判足够。
        lon >= 72.004 && lon <= 137.8347 && lat >= 0.8293 && lat <= 55.8271
    }

    // MARK: - 标准偏移算法

    private static let a = 6378245.0               // 克拉索夫斯基椭球长半轴
    private static let ee = 0.00669342162296594323 // 偏心率平方

    private static func delta(lat: Double, lon: Double) -> (Double, Double) {
        let dLat0 = transformLat(x: lon - 105.0, y: lat - 35.0)
        let dLon0 = transformLon(x: lon - 105.0, y: lat - 35.0)
        let radLat = lat / 180.0 * .pi
        var magic = sin(radLat)
        magic = 1 - ee * magic * magic
        let sqrtMagic = sqrt(magic)
        let dLat = (dLat0 * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * .pi)
        let dLon = (dLon0 * 180.0) / (a / sqrtMagic * cos(radLat) * .pi)
        return (dLat, dLon)
    }

    private static func transformLat(x: Double, y: Double) -> Double {
        var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * sqrt(abs(x))
        ret += (20.0 * sin(6.0 * x * .pi) + 20.0 * sin(2.0 * x * .pi)) * 2.0 / 3.0
        ret += (20.0 * sin(y * .pi) + 40.0 * sin(y / 3.0 * .pi)) * 2.0 / 3.0
        ret += (160.0 * sin(y / 12.0 * .pi) + 320 * sin(y * .pi / 30.0)) * 2.0 / 3.0
        return ret
    }

    private static func transformLon(x: Double, y: Double) -> Double {
        var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * sqrt(abs(x))
        ret += (20.0 * sin(6.0 * x * .pi) + 20.0 * sin(2.0 * x * .pi)) * 2.0 / 3.0
        ret += (20.0 * sin(x * .pi) + 40.0 * sin(x / 3.0 * .pi)) * 2.0 / 3.0
        ret += (150.0 * sin(x / 12.0 * .pi) + 300.0 * sin(x / 30.0 * .pi)) * 2.0 / 3.0
        return ret
    }
}
