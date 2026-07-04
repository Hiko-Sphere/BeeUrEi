import Foundation
import CoreLocation

/// 天气播报（主屏环境感知键之一）：一次性定位 → Open-Meteo（免 key、仅发送坐标，无任何身份信息）
/// → 核心 WeatherPhrase 组装双语文案 → 语音总线 .query 通道播报（避障/导航播报中不重叠）。
/// 对盲人出行的关键价值在建议句：雨雪→带伞防滑、冰点→路面结冰提醒。
final class WeatherSpeaker: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var fetching = false // 防重入：上一次还没播完结果时忽略新点击
    private var watchdog: DispatchWorkItem? // 看门狗：定位/网络无回调时复位，避免永久卡死（"天气不可用"根因）
    private var lang: Language { FeatureSettings().language }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer // 天气只需公里级，省电省时
    }

    func announce() {
        guard !fetching else { return }
        fetching = true
        speak(WeatherPhrase.fetching(lang))
        // 看门狗：15s 内无任何结果就复位 + 提示，杜绝因 requestLocation 无回调导致 fetching 永久为真、之后再点无反应。
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.fetching else { return }
            self.fetching = false
            self.speak(WeatherPhrase.failed(self.lang))
        }
        watchdog = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: work)
        // 关键修复：按授权状态分支。未决时先请求授权，待 didChangeAuthorization 授权后再定位；
        // 不能在 .notDetermined 时直接 requestLocation()——那次请求会与授权弹窗竞争而常常无回调。
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            finishFailure(WeatherPhrase.needLocation(lang))
        @unknown default:
            manager.requestWhenInUseAuthorization()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard fetching else { return } // 仅在等待本次请求时响应授权变化
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation() // 授权通过后才真正发起定位
        case .denied, .restricted:
            finishFailure(WeatherPhrase.needLocation(lang))
        default:
            break // .notDetermined：继续等用户在系统弹窗里决定
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { finishFailure(WeatherPhrase.needLocation(lang)); return }
        let l = lang // 在主线程（定位回调）读取语言，避免后台 Task 里读 FeatureSettings 造成数据竞争（见 P2 审计）
        Task { await fetch(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude, lang: l) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finishFailure(WeatherPhrase.needLocation(lang))
    }

    /// 失败复位：取消看门狗、复位 fetching、播报原因。
    private func finishFailure(_ text: String) {
        guard fetching else { return }
        watchdog?.cancel(); watchdog = nil
        fetching = false
        speak(text)
    }

    /// 网络取天气 → 主线程复位状态并播报（所有共享状态只在主线程改，见 P2 审计）。
    private func fetch(lat: Double, lon: Double, lang l: Language) async {
        let phrase = await fetchPhrase(lat: lat, lon: lon, lang: l)
        await MainActor.run {
            self.watchdog?.cancel(); self.watchdog = nil
            self.fetching = false
            SpeechHub.shared.speak(phrase, channel: .query, voiceCode: l.voiceCode)
        }
    }

    /// 纯网络请求，不触碰任何实例状态（线程安全）。返回要播报的文案。
    private func fetchPhrase(lat: Double, lon: Double, lang l: Language) async -> String {
        var c = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        c.queryItems = [
            .init(name: "latitude", value: String(format: "%.3f", lat)),   // 坐标降精到 ~百米级，最小化外发
            .init(name: "longitude", value: String(format: "%.3f", lon)),
            .init(name: "current", value: "temperature_2m,weather_code,wind_speed_10m,uv_index"),
            .init(name: "daily", value: "temperature_2m_max,temperature_2m_min,precipitation_probability_max"),
            .init(name: "forecast_days", value: "1"),
            .init(name: "timezone", value: "auto"),
        ]
        struct Response: Decodable {
            struct Current: Decodable {
                let temperature_2m: Double
                let weather_code: Int
                let wind_speed_10m: Double?
                let uv_index: Double?
            }
            struct Daily: Decodable {
                let temperature_2m_max: [Double]
                let temperature_2m_min: [Double]
                let precipitation_probability_max: [Int?]?
            }
            let current: Current
            let daily: Daily?
        }
        var request = URLRequest(url: c.url!)
        request.timeoutInterval = 10
        guard let (data, resp) = try? await URLSession.shared.data(for: request),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let r = try? JSONDecoder().decode(Response.self, from: data) else {
            return WeatherPhrase.failed(l)
        }
        return WeatherPhrase.summary(temperature: r.current.temperature_2m,
                                     code: r.current.weather_code,
                                     windSpeedKmh: r.current.wind_speed_10m,
                                     todayMax: r.daily?.temperature_2m_max.first,
                                     todayMin: r.daily?.temperature_2m_min.first,
                                     precipProbability: r.daily?.precipitation_probability_max?.first ?? nil,
                                     uvIndex: r.current.uv_index,
                                     language: l)
    }

    private func speak(_ text: String) {
        SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode)
    }
}
