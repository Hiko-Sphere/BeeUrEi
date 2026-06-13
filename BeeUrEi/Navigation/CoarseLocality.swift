import Foundation
import CoreLocation

/// 一次性取**粗粒度**地点（省/市/区，不含街道门牌）用于向志愿者展示「求助者大概在哪」。
/// 隐私：只上报 city/district 级别字符串，绝不上报精确坐标或街道地址；未授权直接返回 nil。
///
/// 健壮性（见审查 #4/#12）：① 总超时兜底——定位/反查在弱网或授权流无回调时可能永不返回，
/// 到点返回 nil（locality 是 best-effort 装饰字段，超时不阻断求助）；② 首次未决授权时先请求授权，
/// 待 didChangeAuthorization 授权后再发起定位；③ finish 只 resume 一次。
final class CoarseLocality: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private var cont: CheckedContinuation<String?, Never>?
    private var locale = Locale(identifier: "zh_CN")

    /// 取粗粒度地点；超时/失败/未授权返回 nil（调用方据此省略地点字段）。
    /// `lang` 决定反查地名的语言（默认随 App 语言，让英文用户得到英文地名）。
    func fetch(timeout: TimeInterval = 4, lang: Language = FeatureSettings().language) async -> String? {
        locale = Locale(identifier: lang.localeIdentifier)
        let status = manager.authorizationStatus
        guard status != .denied, status != .restricted else { return nil }
        return await withCheckedContinuation { c in
            cont = c
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyKilometer // 城市级足够，且更省电
            // 总超时：到点强制返回 nil，杜绝任何无回调路径导致的永久挂起。
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in self?.finish(nil) }
            if status == .notDetermined {
                manager.requestWhenInUseAuthorization() // 授权结果在 didChangeAuthorization 里再发起定位
            } else {
                manager.requestLocation()
            }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        case .denied, .restricted:
            finish(nil)
        default:
            break // .notDetermined：等待用户在系统弹窗里决定
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { finish(nil); return }
        geocoder.reverseGeocodeLocation(loc, preferredLocale: locale) { [weak self] placemarks, _ in
            let p = placemarks?.first
            let parts = [p?.administrativeArea, p?.locality, p?.subLocality].compactMap { $0 }
            var seen = Set<String>()
            let unique = parts.filter { seen.insert($0).inserted }
            self?.finish(unique.isEmpty ? nil : unique.joined())
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { finish(nil) }

    /// 仅 resume 一次：超时/授权拒绝/定位失败/反查完成，谁先到谁 resume，其余 no-op。
    private func finish(_ s: String?) {
        guard let c = cont else { return }
        cont = nil
        c.resume(returning: s)
    }
}
