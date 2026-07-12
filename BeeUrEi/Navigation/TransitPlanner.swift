import Foundation
import CoreLocation

/// 公交/地铁出行规划（语音"坐公交/地铁去X"）：一次性定位 → 服务端 /api/nav/transit（逆地理取城市 + 高德公交规划）
/// → 核心 TransitPlanFormatter 组装可听的整段路线 → 语音总线 .query 通道播报。
/// 步行导航只覆盖短途；过城出行全靠公共交通——盲人看不到地图，全程靠这段话建立心理路线。
/// 结构照搬已验证的 WeatherSpeaker（fetching 防重入 + 看门狗 + 授权分支 + 主线程改状态）。
final class TransitPlanner: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var planning = false
    private var destination = ""
    private var watchdog: DispatchWorkItem?
    private var lang: Language { FeatureSettings().language }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    func plan(to dest: String) {
        guard !planning else { return }
        destination = dest.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !destination.isEmpty else {
            speak(lang == .zh ? "请说出你要去哪里" : "Please say where you want to go"); return
        }
        planning = true
        speak(lang == .zh ? "正在规划到\(destination)的公交路线" : "Planning transit to \(destination)")
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.planning else { return }
            self.finish(self.lang == .zh ? "路线规划超时，请稍后再试" : "Transit planning timed out — please try again")
        }
        watchdog = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: work)
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
        guard planning else { return }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        case .denied, .restricted:
            finish(lang == .zh ? "定位权限未开启，请在系统设置中允许定位" : "Location is off. Allow location in Settings.")
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { finish(lang == .zh ? "定位失败，请稍后再试" : "Locating failed — please try again"); return }
        let dest = destination
        let l = lang // 主线程读取，避免后台 Task 里读 FeatureSettings 的数据竞争
        let u = FeatureSettings().distanceUnit // 同上：主线程读距离单位（英制用户步行距离听英尺/英里）
        Task { [weak self] in
            guard let self else { return }
            // 起点 WGS-84 → GCJ-02（与步行导航同一变换），服务端直接喂高德。
            let g = ChinaCoord.wgs84ToGcj02(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
            do {
                let plan = try await AMapTransitClient().transit(originLatGcj: g.lat, originLonGcj: g.lon, destination: dest)
                await MainActor.run { self.finish(TransitPlanFormatter.summary(plan, language: l, unit: u)) }
            } catch {
                await MainActor.run { self.finish(self.failureText(for: error, dest: dest, lang: l)) }
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(lang == .zh ? "定位失败，请检查定位权限与信号" : "Locating failed — check location permission and signal")
    }

    /// 后端错误码 → 盲人可懂的失败原因（透传自 /api/nav/transit）。
    private func failureText(for error: Error, dest: String, lang l: Language) -> String {
        let zh = l == .zh
        guard case let APIError.server(code) = error else {
            return zh ? "公交路线规划失败，请稍后再试" : "Transit planning failed — please try again"
        }
        switch code {
        case "no_transit_route":
            return zh ? "没找到到\(dest)的公交路线，可能距离较近可以步行，或换个说法再试"
                      : "No transit route to \(dest) found — it may be close enough to walk"
        case "destination_not_found":
            return zh ? "找不到目的地\(dest)，请换个说法再试" : "Couldn't find \(dest) — please try another name"
        case "city_unresolved":
            return zh ? "暂时无法确定你所在的城市，公交规划稍后再试" : "Couldn't determine your city — please try again"
        case "amap_not_configured":
            return zh ? "公交导航暂未开通" : "Transit navigation isn't available yet"
        default: // amap_error / nav_unavailable / 其它
            return zh ? "公交路线规划暂时不可用，请稍后再试" : "Transit planning is temporarily unavailable — please try again"
        }
    }

    /// 播报并复位（取消看门狗，防迟到回调重复播）。
    private func finish(_ text: String) {
        guard planning else { return }
        watchdog?.cancel(); watchdog = nil
        planning = false
        speak(text)
    }

    private func speak(_ text: String) {
        SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode)
    }
}
