import XCTest
@testable import BeeUrEiCore

final class ChinaCoordTests: XCTestCase {

    /// 北京天安门附近：GCJ 偏移应在合理量级（几十到几百米，绝不为零、绝不超 1km）。
    func testBeijingOffsetWithinPlausibleRange() {
        let g = ChinaCoord.wgs84ToGcj02(lat: 39.9042, lon: 116.4074)
        let dMeters = Geo.distanceMeters(fromLat: 39.9042, fromLon: 116.4074, toLat: g.lat, toLon: g.lon)
        XCTAssertGreaterThan(dMeters, 50, "境内必须有偏移")
        XCTAssertLessThan(dMeters, 1000, "偏移不应超过 1km")
        // 中国境内 GCJ 偏移方向恒为东北向（lat/lon 增大）。
        XCTAssertGreaterThan(g.lat, 39.9042)
        XCTAssertGreaterThan(g.lon, 116.4074)
    }

    /// 往返转换误差应小于 2 米（近似逆变换可接受）。
    func testRoundTripUnder2Meters() {
        let wgs = (lat: 31.2304, lon: 121.4737) // 上海
        let g = ChinaCoord.wgs84ToGcj02(lat: wgs.lat, lon: wgs.lon)
        let back = ChinaCoord.gcj02ToWgs84(lat: g.lat, lon: g.lon)
        let err = Geo.distanceMeters(fromLat: wgs.lat, fromLon: wgs.lon, toLat: back.lat, toLon: back.lon)
        XCTAssertLessThan(err, 2)
    }

    /// 境外坐标必须原样返回（GCJ 偏移仅境内）。
    func testOutsideChinaPassthrough() {
        let tokyo = ChinaCoord.wgs84ToGcj02(lat: 35.6762, lon: 139.6503)
        XCTAssertEqual(tokyo.lat, 35.6762)
        XCTAssertEqual(tokyo.lon, 139.6503)
        let sf = ChinaCoord.wgs84ToGcj02(lat: 37.7749, lon: -122.4194)
        XCTAssertEqual(sf.lon, -122.4194)
    }

    /// 不同城市偏移不同（算法是位置相关的，不是常量平移）。
    func testOffsetVariesByLocation() {
        let bj = ChinaCoord.wgs84ToGcj02(lat: 39.9042, lon: 116.4074)
        let gz = ChinaCoord.wgs84ToGcj02(lat: 23.1291, lon: 113.2644)
        let dBj = (bj.lat - 39.9042, bj.lon - 116.4074)
        let dGz = (gz.lat - 23.1291, gz.lon - 113.2644)
        XCTAssertNotEqual(dBj.0, dGz.0, accuracy: 1e-7)
    }
}
