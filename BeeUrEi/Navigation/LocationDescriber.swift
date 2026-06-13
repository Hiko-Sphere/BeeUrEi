import Foundation
import CoreLocation
import MapKit
import UIKit
import AVFoundation

/// 环境感知三键（Soundscape 式）：
/// - 「我在哪」：反查地址 + 附近地点；
/// - 「周围有什么」：按**时钟方位**播报四周地点（"三点钟方向约50米，全家便利店"）；
/// - 「前方有什么」：只报朝向 ±50° 扇区内的地点。
/// 不导航也能建立心理地图。端侧 CLGeocoder/MKLocalSearch，无需后端。
final class LocationDescriber: NSObject, CLLocationManagerDelegate {
    enum Mode { case whereAmI, around, ahead }

    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private var isDescribing = false // 防重入：上一次还在解析时忽略新点击（见审查 #3）
    private var mode: Mode = .whereAmI
    private var lastHeading: Double? // 最近真北航向（罗盘），供相对方位计算
    private var watchdog: DispatchWorkItem? // 看门狗：定位/解析无回调时复位，避免永久卡死
    private var lang: Language = FeatureSettings().language // 播报语言（E5，每次触发时解析）

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    func describe() { run(.whereAmI) }
    func describeAround() { run(.around) }
    func describeAhead() { run(.ahead) }

    private func promptFor(_ m: Mode) -> String {
        switch m {
        case .whereAmI: return lang == .zh ? "正在确定你的位置" : "Finding your location"
        case .around: return lang == .zh ? "正在查看周围有什么" : "Checking what's around you"
        case .ahead: return lang == .zh ? "正在查看前方有什么" : "Checking what's ahead"
        }
    }

    private func run(_ m: Mode) {
        guard !isDescribing else { return }
        lang = FeatureSettings().language
        mode = m
        isDescribing = true
        speak(promptFor(m))
        // 看门狗：20s 无结果就复位（含网络 POI 检索），避免 requestLocation 无回调导致永久卡死后再点无反应。
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.isDescribing else { return }
            self.finish(self.lang == .zh ? "定位超时，请检查定位权限与信号后重试"
                                         : "Locating timed out — check location permission and signal, then retry")
        }
        watchdog = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: work)
        manager.startUpdatingHeading() // 周围/前方需要朝向；我在哪不依赖（拿到也无妨）
        // 按授权状态分支：未决时先请求授权，授权后在 didChangeAuthorization 里再定位
        // （.notDetermined 时直接 requestLocation 会与授权弹窗竞争而常常无回调）。
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            finish(lang == .zh ? "定位权限未开启，请在系统设置中允许定位" : "Location is off. Allow location in Settings.")
        @unknown default:
            manager.requestWhenInUseAuthorization()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard isDescribing else { return }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        case .denied, .restricted:
            finish(lang == .zh ? "定位权限未开启，请在系统设置中允许定位" : "Location is off. Allow location in Settings.")
        default:
            break // .notDetermined：等用户在系统弹窗里决定
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard newHeading.headingAccuracy >= 0 else { return } // 罗盘不可信不更新
        lastHeading = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        switch mode {
        case .whereAmI:
            geocoder.reverseGeocodeLocation(loc, preferredLocale: Locale(identifier: lang.localeIdentifier)) { [weak self] placemarks, _ in
                guard let self else { return }
                let address = Self.addressString(placemarks?.first, self.lang)
                self.findNearby(loc) { nearby in
                    let near = self.lang == .zh ? "。附近有：" : ". Nearby: "
                    let text = nearby.isEmpty ? address : address + near + nearby
                    self.finish(text)
                }
            }
        case .around, .ahead:
            poiCallouts(loc)
        }
    }

    /// 周围/前方：POI 按时钟方位 + 距离播报（朝向不可用时退化为只报距离）。
    private func poiCallouts(_ loc: CLLocation) {
        let radius: CLLocationDistance = mode == .ahead ? 400 : 250
        let request = MKLocalPointsOfInterestRequest(center: loc.coordinate, radius: radius)
        MKLocalSearch(request: request).start { [weak self] response, _ in
            guard let self else { return }
            let heading = self.lastHeading
            let ahead = self.mode == .ahead
            var entries: [(text: String, dist: Double)] = []
            for item in (response?.mapItems ?? []).prefix(15) {
                guard let name = item.name, let ploc = item.placemark.location else { continue }
                let dist = loc.distance(from: ploc)
                guard dist > 5 else { continue }
                if let heading {
                    let bearing = Geo.initialBearing(fromLat: loc.coordinate.latitude, fromLon: loc.coordinate.longitude,
                                                     toLat: ploc.coordinate.latitude, toLon: ploc.coordinate.longitude)
                    var rel = (bearing - heading).truncatingRemainder(dividingBy: 360)
                    if rel > 180 { rel -= 360 } else if rel < -180 { rel += 360 }
                    if ahead, abs(rel) > 50 { continue } // 前方模式：只要朝向 ±50° 扇区
                    let hour = ClockDirection(angleDegrees: rel).hour
                    let m = Int(dist.rounded())
                    let phrase = self.lang == .zh ? "\(hour)点钟方向约\(m)米，\(name)"
                                                  : "\(name), about \(m) meters, \(hour) o'clock"
                    entries.append((phrase, dist))
                } else {
                    if ahead { continue } // 没有朝向，"前方"无从谈起——下面会提示
                    let m = Int(dist.rounded())
                    entries.append((self.lang == .zh ? "约\(m)米，\(name)" : "\(name), about \(m) meters", dist))
                }
            }
            entries.sort { $0.dist < $1.dist }
            let picked = entries.prefix(ahead ? 3 : 4).map(\.text)
            let zh = self.lang == .zh
            let text: String
            if picked.isEmpty {
                text = ahead
                    ? (heading == nil ? (zh ? "无法确定你的朝向，请稍后再试" : "Can't determine your heading — try again")
                                      : (zh ? "前方\(Int(radius))米内没有查到地点" : "No places found within \(Int(radius)) meters ahead"))
                    : (zh ? "周围\(Int(radius))米内没有查到地点" : "No places found within \(Int(radius)) meters around you")
            } else {
                let sep = zh ? "。" : ". "
                let prefix = ahead ? (zh ? "前方：" : "Ahead: ") : (zh ? "周围：" : "Around you: ")
                text = prefix + picked.joined(separator: sep)
            }
            self.finish(text)
        }
    }

    /// 播报结果并复位（停罗盘省电）。
    private func finish(_ text: String) {
        guard isDescribing else { return } // 已复位（如看门狗已触发）则不重复播报
        watchdog?.cancel(); watchdog = nil
        speak(text)
        manager.stopUpdatingHeading()
        isDescribing = false
    }

    private static func addressString(_ p: CLPlacemark?, _ lang: Language) -> String {
        let parts = [p?.locality, p?.subLocality, p?.thoroughfare, p?.subThoroughfare, p?.name].compactMap { $0 }
        var seen = Set<String>()
        let unique = parts.filter { seen.insert($0).inserted }
        if unique.isEmpty { return lang == .zh ? "无法确定当前位置" : "Can't determine your location" }
        let sep = lang == .zh ? "，" : ", "
        return (lang == .zh ? "你大概在：" : "You're near: ") + unique.joined(separator: sep)
    }

    private func findNearby(_ loc: CLLocation, completion: @escaping (String) -> Void) {
        let request = MKLocalPointsOfInterestRequest(center: loc.coordinate, radius: 250)
        let zh = lang == .zh
        MKLocalSearch(request: request).start { response, _ in
            let descriptions = (response?.mapItems ?? []).prefix(3).compactMap { item -> String? in
                guard let name = item.name, let placeLoc = item.placemark.location else { return nil }
                let m = Int(loc.distance(from: placeLoc).rounded())
                return zh ? "\(name) 约\(m)米" : "\(name) about \(m) m"
            }
            completion(descriptions.joined(separator: zh ? "，" : ", "))
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(lang == .zh ? "定位失败，请检查定位权限与信号" : "Locating failed — check location permission and signal")
    }

    /// 经全局语音总线 .query 通道：避障/导航播报期间不再同时出声（积压待其说完补播）。嗓音随 App 语言。
    private func speak(_ text: String) {
        SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode)
    }
}
