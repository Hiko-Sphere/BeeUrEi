import Foundation
import CoreLocation
import MapKit
import UIKit
import AVFoundation

/// "我在哪"：一次性取当前位置 → 端侧 CLGeocoder 反查地址 → 语音播报。
/// 端侧、无需后端（海外）；盲人常用的"我现在大概在哪"。
final class LocationDescriber: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private let synth = AVSpeechSynthesizer()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    func describe() {
        speak("正在确定你的位置")
        manager.requestWhenInUseAuthorization()
        manager.requestLocation() // 一次性定位
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        geocoder.reverseGeocodeLocation(loc, preferredLocale: Locale(identifier: "zh_CN")) { [weak self] placemarks, _ in
            guard let self else { return }
            let address = Self.addressString(placemarks?.first)
            // 同时查附近地点（POI），给出完整方位感。
            self.findNearby(loc) { nearby in
                let text = nearby.isEmpty ? address : address + "。附近有：" + nearby
                self.speak(text)
            }
        }
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
