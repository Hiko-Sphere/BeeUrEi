import Foundation
import CoreLocation

/// 一次性取**粗粒度**地点（省/市/区，不含街道门牌）用于向志愿者展示「求助者大概在哪」。
/// 隐私：只上报 city/district 级别字符串，绝不上报精确坐标或街道地址；未授权直接返回 nil。
final class CoarseLocality: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private var cont: CheckedContinuation<String?, Never>?

    /// 取粗粒度地点；失败/未授权返回 nil（调用方据此省略地点字段）。
    func fetch() async -> String? {
        let status = manager.authorizationStatus
        guard status != .denied, status != .restricted else { return nil }
        return await withCheckedContinuation { c in
            cont = c
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyKilometer // 城市级足够，且更省电
            manager.requestWhenInUseAuthorization()
            manager.requestLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { finish(nil); return }
        geocoder.reverseGeocodeLocation(loc, preferredLocale: Locale(identifier: "zh_CN")) { [weak self] placemarks, _ in
            let p = placemarks?.first
            let parts = [p?.administrativeArea, p?.locality, p?.subLocality].compactMap { $0 }
            var seen = Set<String>()
            let unique = parts.filter { seen.insert($0).inserted }
            self?.finish(unique.isEmpty ? nil : unique.joined())
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { finish(nil) }

    private func finish(_ s: String?) {
        cont?.resume(returning: s)
        cont = nil
    }
}
