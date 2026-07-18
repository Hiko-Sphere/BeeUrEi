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
    /// 天气与空气质量两个请求并发跑（async let），空气质量是"锦上添花"：失败/超时只是不追加、绝不拖垮天气。
    private func fetch(lat: Double, lon: Double, lang l: Language) async {
        async let phraseTask = fetchPhrase(lat: lat, lon: lon, lang: l)
        async let airTask = fetchAirQuality(lat: lat, lon: lon)
        let weather = await phraseTask  // nil = 天气取数失败
        let air = await airTask
        // 天气失败：只报失败，**绝不**把空气质量拼到失败句后（否则"天气获取失败…空气中度污染"自相矛盾且无分隔，见自审 #1）。
        var phrase = weather ?? WeatherPhrase.failed(l)
        // 空气质量健康提醒（盲人看不到雾霾/扬尘）：仅天气成功且"污染"档才追加，优/良不打扰；PM2.5 与 PM10 取更差一档（扬尘天不漏报）。
        if weather != nil, let advice = WeatherPhrase.airQualityAdvice(pm25: air.pm25, pm10: air.pm10, language: l) {
            phrase += advice
        }
        let finalPhrase = phrase // 定格为不可变，供并发 MainActor 闭包安全捕获（消除 var 捕获数据竞争告警，Swift 6 下为错误）
        await MainActor.run {
            self.watchdog?.cancel(); self.watchdog = nil
            self.fetching = false
            SpeechHub.shared.speak(finalPhrase, channel: .query, voiceCode: l.voiceCode)
        }
    }

    /// 空气质量颗粒物（PM2.5 + PM10，µg/m³）：Open-Meteo 空气质量 API（免 key、仅发坐标）。best-effort——任何失败两者皆 nil。
    /// PM10 一并取：北方春季**扬沙/浮尘/沙尘暴**时 PM2.5 可能未超标而 PM10 高企，只看 PM2.5 会漏报（假安心，见 WeatherPhrase）。
    private func fetchAirQuality(lat: Double, lon: Double) async -> (pm25: Double?, pm10: Double?) {
        var c = URLComponents(string: "https://air-quality-api.open-meteo.com/v1/air-quality")!
        c.queryItems = [
            .init(name: "latitude", value: String(format: "%.3f", lat)),
            .init(name: "longitude", value: String(format: "%.3f", lon)),
            .init(name: "current", value: "pm2_5,pm10"),
            .init(name: "timezone", value: "auto"),
        ]
        struct Response: Decodable {
            struct Current: Decodable { let pm2_5: Double?; let pm10: Double? }
            let current: Current?
        }
        var request = URLRequest(url: c.url!)
        request.timeoutInterval = 8 // 短于天气看门狗；空气慢/挂不拖累天气播报
        guard let (data, resp) = try? await URLSession.shared.data(for: request),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let r = try? JSONDecoder().decode(Response.self, from: data) else { return (nil, nil) }
        return (r.current?.pm2_5, r.current?.pm10)
    }

    /// 纯网络请求，不触碰任何实例状态（线程安全）。成功返回文案，**失败返回 nil**（由 fetch() 决定是否只报失败、
    /// 不与空气质量拼接，见自审 #1）。
    private func fetchPhrase(lat: Double, lon: Double, lang l: Language) async -> String? {
        var c = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        c.queryItems = [
            .init(name: "latitude", value: String(format: "%.3f", lat)),   // 坐标降精到 ~百米级，最小化外发
            .init(name: "longitude", value: String(format: "%.3f", lon)),
            .init(name: "current", value: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,uv_index"),
            .init(name: "daily", value: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunset,sunrise"),
            .init(name: "hourly", value: "precipitation_probability"), // 逐小时降水概率 → 近期"约N小时后可能下雨"
            .init(name: "forecast_days", value: "1"),
            .init(name: "timezone", value: "auto"),
        ]
        struct Response: Decodable {
            struct Current: Decodable {
                let time: String            // 当前小时时间戳（用于在 hourly 里定位当前小时）
                let temperature_2m: Double
                let apparent_temperature: Double?
                let weather_code: Int
                let wind_speed_10m: Double?
                let uv_index: Double?
            }
            struct Daily: Decodable {
                let temperature_2m_max: [Double]
                let temperature_2m_min: [Double]
                let precipitation_probability_max: [Int?]?
                let sunset: [String]?   // 当日日落时刻（ISO，本地时区）→ 黄昏行人安全提醒
                let sunrise: [String]?  // 当日日出时刻（ISO，本地时区）→ 黎明行人安全提醒（与黄昏对称）
            }
            struct Hourly: Decodable {
                let time: [String]
                let precipitation_probability: [Int?]?
            }
            let current: Current
            let daily: Daily?
            let hourly: Hourly?
        }
        var request = URLRequest(url: c.url!)
        request.timeoutInterval = 10
        guard let (data, resp) = try? await URLSession.shared.data(for: request),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let r = try? JSONDecoder().decode(Response.self, from: data) else {
            return nil // 取数失败：由 fetch() 统一映射为失败文案，且不拼接空气质量
        }
        // 近期降水时点：在 hourly 里按「当前小时前缀」（"2026-07-04T15"）定位当前小时索引，交给核心算「约几小时后下雨」。
        var rainInHours: Int?
        if let hourly = r.hourly, let probs = hourly.precipitation_probability {
            let hourPrefix = String(r.current.time.prefix(13)) // yyyy-MM-ddTHH
            if let idx = hourly.time.firstIndex(where: { $0.hasPrefix(hourPrefix) }) {
                rainInHours = WeatherPhrase.hoursUntilLikelyRain(probabilities: probs, startIndex: idx)
            }
        }
        let base = WeatherPhrase.summary(temperature: r.current.temperature_2m,
                                         code: r.current.weather_code,
                                         windSpeedKmh: r.current.wind_speed_10m,
                                         todayMax: r.daily?.temperature_2m_max.first,
                                         todayMin: r.daily?.temperature_2m_min.first,
                                         precipProbability: r.daily?.precipitation_probability_max?.first ?? nil,
                                         uvIndex: r.current.uv_index,
                                         rainInHours: rainInHours,
                                         apparentTemp: r.current.apparent_temperature,
                                         language: l)
        // 黄昏/黎明行人安全：盲人感知不到天色明暗，而日落前后**与日出前后**同为行人被撞高发时段（司机弱光/低阳晃眼看不清）。
        // 现在时刻与今日日出/日落时刻都来自同一响应（timezone=auto 本地时刻），交给核心判是否落在任一窗口。
        if let nowMin = WeatherPhrase.minuteOfDay(fromISO: r.current.time) {
            let sunsetMin = (r.daily?.sunset?.first ?? nil).flatMap(WeatherPhrase.minuteOfDay(fromISO:))
            let sunriseMin = (r.daily?.sunrise?.first ?? nil).flatMap(WeatherPhrase.minuteOfDay(fromISO:))
            if let twilight = WeatherPhrase.twilightSafety(nowMinuteOfDay: nowMin, sunsetMinuteOfDay: sunsetMin,
                                                           sunriseMinuteOfDay: sunriseMin, language: l) {
                return base + twilight
            }
        }
        return base
    }

    private func speak(_ text: String) {
        SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode)
    }
}
