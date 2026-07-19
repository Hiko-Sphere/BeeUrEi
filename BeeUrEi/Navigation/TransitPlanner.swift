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
    private var destCoordinate: (lat: Double, lon: Double)? // WGS-84；给了则按坐标精确规划（聊天分享位置），否则按 destination 名字 geocode
    private var watchdog: DispatchWorkItem?
    private var lang: Language { FeatureSettings().language }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    func plan(to dest: String) {
        guard !planning else { return }
        destCoordinate = nil // 按名字规划：清掉可能残留的坐标（否则会误用上次的精确坐标）
        destination = dest.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !destination.isEmpty else {
            speak(lang == .zh ? "请说出你要去哪里" : "Please say where you want to go"); return
        }
        beginPlanning()
    }

    /// 按**已知精确坐标**规划公交（聊天分享位置的跨城出行）：绝不按地名重搜（与步行 pendingNavAction=.coordinate 同款）。
    /// coord 为 WGS-84（与 payload/全栈一致）；name 仅用于播报"正在规划到X的公交路线"，缺则用通用词。
    func plan(toCoordinate coord: CLLocationCoordinate2D, name: String?) {
        guard !planning else { return }
        destCoordinate = (lat: coord.latitude, lon: coord.longitude)
        let n = (name?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 }
        destination = n ?? (lang == .zh ? "那里" : "there")
        beginPlanning()
    }

    private func beginPlanning() {
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
        // 精确坐标（聊天分享位置）：WGS-84 → GCJ-02（同起点/步行导航变换），传服务端 destGcj 跳过 geocode，绝不按名重搜。
        let destGcj = destCoordinate.map { ChinaCoord.wgs84ToGcj02(lat: $0.lat, lon: $0.lon) }.map { (lat: $0.lat, lon: $0.lon) }
        let l = lang // 主线程读取，避免后台 Task 里读 FeatureSettings 的数据竞争
        let u = FeatureSettings().distanceUnit // 同上：主线程读距离单位（英制用户步行距离听英尺/英里）
        Task { [weak self] in
            guard let self else { return }
            // 起点 WGS-84 → GCJ-02（与步行导航同一变换），服务端直接喂高德。
            let g = ChinaCoord.wgs84ToGcj02(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
            do {
                let plan = try await AMapTransitClient().transit(originLatGcj: g.lat, originLonGcj: g.lon, destination: dest, destGcj: destGcj)
                await MainActor.run {
                    // 预计到达时刻（now+总时长）：盲人据此判断能否赶上约定，省心算——与步行导航同源、公交此前只报总时长。
                    let arrival = self.arrivalClockString(durationSeconds: plan.durationSeconds, lang: l)
                    self.finish(TransitPlanFormatter.summary(plan, language: l, unit: u, arrivalClock: arrival))
                }
            } catch {
                let code: String? = { if case let APIError.server(c) = error { return c } else { return nil } }()
                // 直线距离仅精确坐标规划时可算（GCJ 两点间距离≈WGS，用于 no_transit_route 判"是否值得建议步行"）。
                let straight = destGcj.map { Geo.distanceMeters(fromLat: g.lat, fromLon: g.lon, toLat: $0.lat, toLon: $0.lon) }
                await MainActor.run { self.finish(TransitPlanner.failureText(code: code, dest: dest, straightLineMeters: straight, l)) }
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(lang == .zh ? "定位失败，请检查定位权限与信号" : "Locating failed — check location permission and signal")
    }

    /// now + 总时长 → 本地化时钟到达时刻（"下午3:25"/"3:25 PM"，12/24 制随 locale）。与步行导航 arrivalClockString 同源同措辞。
    /// 非有限/负时长（上游脏数据）→ nil（不凭空报到达时刻）。
    private func arrivalClockString(durationSeconds: Double, lang l: Language) -> String? {
        guard durationSeconds.isFinite, durationSeconds >= 0 else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: l.localeIdentifier)
        f.setLocalizedDateFormatFromTemplate("jmm")
        return f.string(from: Date().addingTimeInterval(durationSeconds))
    }

    /// 后端错误码 → 盲人可懂的失败原因（透传自 /api/nav/transit）。纯逻辑·可单测。
    /// - code: nil 表示非服务端错误（网络/解析等）——给通用重试文案。
    /// - straightLineMeters: 起点→目的地直线距离(米)，仅**精确坐标**规划(聊天分享位置)时可知；名字规划为 nil。
    ///   no_transit_route 时据此避免对**远处**目的地误建议"可以步行"——跨城/无公交覆盖同样报 no_transit_route（见服务端），
    ///   对 3km 外的地点说"可以步行"是危险的误导（盲人真会试着走）。
    static func failureText(code: String?, dest: String, straightLineMeters: Double?, _ l: Language) -> String {
        let zh = l == .zh
        guard let code else {
            return zh ? "公交路线规划失败，请稍后再试" : "Transit planning failed — please try again"
        }
        switch code {
        case "no_transit_route":
            // 已知直线距离且较远(≥2km) → 步行不现实，绝不建议步行；较近或距离未知 → 保留"可步行"提示。
            if let m = straightLineMeters, m.isFinite, m >= 2000 {
                return zh ? "没找到到\(dest)的公交路线，该地点较远，请换个说法或核对地点再试"
                          : "No transit route to \(dest) found — it's quite far; try another name or check the place"
            }
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
