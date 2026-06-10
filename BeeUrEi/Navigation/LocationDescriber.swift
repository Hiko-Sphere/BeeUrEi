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
    private let synth = AVSpeechSynthesizer()
    private var isDescribing = false // 防重入：上一次还在解析时忽略新点击（见审查 #3）
    private var mode: Mode = .whereAmI
    private var lastHeading: Double? // 最近真北航向（罗盘），供相对方位计算

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    func describe() { run(.whereAmI, prompt: "正在确定你的位置") }
    func describeAround() { run(.around, prompt: "正在查看周围有什么") }
    func describeAhead() { run(.ahead, prompt: "正在查看前方有什么") }

    private func run(_ m: Mode, prompt: String) {
        guard !isDescribing else { return }
        mode = m
        isDescribing = true
        speak(prompt)
        manager.requestWhenInUseAuthorization()
        manager.startUpdatingHeading() // 周围/前方需要朝向；我在哪不依赖（拿到也无妨）
        manager.requestLocation()      // 一次性定位
    }

    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard newHeading.headingAccuracy >= 0 else { return } // 罗盘不可信不更新
        lastHeading = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        switch mode {
        case .whereAmI:
            geocoder.reverseGeocodeLocation(loc, preferredLocale: Locale(identifier: "zh_CN")) { [weak self] placemarks, _ in
                guard let self else { return }
                let address = Self.addressString(placemarks?.first)
                self.findNearby(loc) { nearby in
                    let text = nearby.isEmpty ? address : address + "。附近有：" + nearby
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
                    entries.append(("\(hour)点钟方向约\(Int(dist.rounded()))米，\(name)", dist))
                } else {
                    if ahead { continue } // 没有朝向，"前方"无从谈起——下面会提示
                    entries.append(("约\(Int(dist.rounded()))米，\(name)", dist))
                }
            }
            entries.sort { $0.dist < $1.dist }
            let picked = entries.prefix(ahead ? 3 : 4).map(\.text)
            let text: String
            if picked.isEmpty {
                text = ahead
                    ? (heading == nil ? "无法确定你的朝向，请稍后再试" : "前方\(Int(radius))米内没有查到地点")
                    : "周围\(Int(radius))米内没有查到地点"
            } else {
                text = (ahead ? "前方：" : "周围：") + picked.joined(separator: "。")
            }
            self.finish(text)
        }
    }

    /// 播报结果并复位（停罗盘省电）。
    private func finish(_ text: String) {
        speak(text)
        manager.stopUpdatingHeading()
        isDescribing = false
    }

    private static func addressString(_ p: CLPlacemark?) -> String {
        let parts = [p?.locality, p?.subLocality, p?.thoroughfare, p?.subThoroughfare, p?.name].compactMap { $0 }
        var seen = Set<String>()
        let unique = parts.filter { seen.insert($0).inserted }
        return unique.isEmpty ? "无法确定当前位置" : "你大概在：" + unique.joined(separator: "，")
    }

    private func findNearby(_ loc: CLLocation, completion: @escaping (String) -> Void) {
        let request = MKLocalPointsOfInterestRequest(center: loc.coordinate, radius: 250)
        MKLocalSearch(request: request).start { response, _ in
            let descriptions = (response?.mapItems ?? []).prefix(3).compactMap { item -> String? in
                guard let name = item.name, let placeLoc = item.placemark.location else { return nil }
                return "\(name) 约\(Int(loc.distance(from: placeLoc).rounded()))米"
            }
            completion(descriptions.joined(separator: "，"))
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        speak("定位失败，请检查定位权限与信号")
        manager.stopUpdatingHeading()
        isDescribing = false
    }

    private func speak(_ text: String) {
        if UIAccessibility.isVoiceOverRunning {
            UIAccessibility.post(notification: .announcement, argument: text)
            return
        }
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        u.rate = AVSpeechUtteranceMinimumSpeechRate
            + (AVSpeechUtteranceMaximumSpeechRate - AVSpeechUtteranceMinimumSpeechRate) * FeatureSettings().speechRate
        synth.stopSpeaking(at: .immediate)
        synth.speak(u)
    }
}
