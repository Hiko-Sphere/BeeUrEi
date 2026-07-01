import Foundation

/// 天气播报文案（纯逻辑）：WMO 天气码 → 双语描述 + 一句话播报 + 盲人出行建议。
/// 数据源为 Open-Meteo（WMO weather interpretation codes），App 层取数后在此组装。
public enum WeatherPhrase {

    /// WMO 天气码 → 天气描述（双语）。未知码退化为"天气未知"。
    public static func condition(code: Int, language: Language) -> String {
        let zh: String
        let en: String
        switch code {
        case 0: zh = "晴"; en = "clear"
        case 1: zh = "大致晴朗"; en = "mostly clear"
        case 2: zh = "多云"; en = "partly cloudy"
        case 3: zh = "阴"; en = "overcast"
        case 45, 48: zh = "有雾"; en = "foggy"
        case 51, 53, 55: zh = "毛毛雨"; en = "drizzle"
        case 56, 57: zh = "冻雨"; en = "freezing drizzle"
        case 61: zh = "小雨"; en = "light rain"
        case 63: zh = "中雨"; en = "rain"
        case 65: zh = "大雨"; en = "heavy rain"
        case 66, 67: zh = "冻雨"; en = "freezing rain"
        case 71: zh = "小雪"; en = "light snow"
        case 73: zh = "中雪"; en = "snow"
        case 75: zh = "大雪"; en = "heavy snow"
        case 77: zh = "雪粒"; en = "snow grains"
        case 80, 81: zh = "阵雨"; en = "rain showers"
        case 82: zh = "强阵雨"; en = "violent rain showers"
        case 85, 86: zh = "阵雪"; en = "snow showers"
        case 95: zh = "雷暴"; en = "thunderstorm"
        case 96, 99: zh = "雷暴伴冰雹"; en = "thunderstorm with hail"
        default: zh = "天气未知"; en = "unknown conditions"
        }
        return language == .zh ? zh : en
    }

    /// 一句话天气播报：当前温度/天气 + 今日最高最低 + 降水概率 + 出行建议。
    /// 温度四舍五入为整数（语音听感）；缺失字段自动省略。
    /// 安全把温度(可负；可能来自异常 API 响应的 NaN/∞/巨值)四舍五入为 Int，防 `Int(非有限/越界 Double)`
    /// 陷阱崩溃（同 ClockDirection/距离播报一类）。地表温度远在 ±1000℃ 内，非有限退化为 0。
    static func safeTemp(_ v: Double) -> Int {
        guard v.isFinite else { return 0 }
        return Int(min(max(v, -1000), 1000).rounded())
    }

    public static func summary(temperature: Double, code: Int,
                               windSpeedKmh: Double? = nil,
                               todayMax: Double? = nil, todayMin: Double? = nil,
                               precipProbability: Int? = nil,
                               language: Language) -> String {
        let cond = condition(code: code, language: language)
        let t = safeTemp(temperature)
        var parts: [String] = []
        if language == .zh {
            parts.append("现在\(cond)，气温\(t)度")
            if let mx = todayMax, let mn = todayMin {
                parts.append("今天最高\(safeTemp(mx))度，最低\(safeTemp(mn))度")
            }
            if let p = precipProbability, p >= 20 { parts.append("降水概率百分之\(p)") }
            if let w = windSpeedKmh, w >= 29 { parts.append("风较大") } // ≥5级（29km/h）才提醒
        } else {
            parts.append("It's \(cond), \(t) degrees")
            if let mx = todayMax, let mn = todayMin {
                parts.append("today's high \(safeTemp(mx)), low \(safeTemp(mn))")
            }
            if let p = precipProbability, p >= 20 { parts.append("\(p) percent chance of rain") }
            if let w = windSpeedKmh, w >= 29 { parts.append("quite windy") }
        }
        var text = parts.joined(separator: language == .zh ? "，" : ", ") + (language == .zh ? "。" : ".")
        if let tip = advice(code: code, todayMax: todayMax, todayMin: todayMin,
                            precipProbability: precipProbability, language: language) {
            text += tip
        }
        return text
    }

    /// 盲人出行建议：雨雪雷暴/高降水→带伞防滑；高温/严寒提醒。无建议返回 nil。
    public static func advice(code: Int, todayMax: Double?, todayMin: Double?,
                              precipProbability: Int?, language: Language) -> String? {
        let wet: Set<Int> = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]
        if wet.contains(code) || (precipProbability ?? 0) >= 50 {
            return language == .zh ? "出门请带伞，地面可能湿滑。" : " Bring an umbrella; the ground may be slippery."
        }
        if let mx = todayMax, mx >= 35 {
            return language == .zh ? "今天高温，注意防暑补水。" : " Very hot today; stay hydrated."
        }
        if let mn = todayMin, mn <= 0 {
            return language == .zh ? "气温在冰点以下，路面可能结冰，出行小心。" : " Below freezing; watch for ice."
        }
        return nil
    }

    /// 取数过程提示与失败文案（App 层播报用，集中在此保持双语一致）。
    public static func fetching(_ l: Language) -> String { l == .zh ? "正在获取天气" : "Getting the weather" }
    public static func failed(_ l: Language) -> String {
        l == .zh ? "天气获取失败，请检查网络后再试" : "Couldn't get the weather. Check your connection and try again."
    }
    public static func needLocation(_ l: Language) -> String {
        l == .zh ? "定位失败，无法获取当地天气" : "Location unavailable, can't get local weather."
    }
}
