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

    /// 从逐小时降水概率数组算「还有几小时开始下雨」：从 startIndex(当前小时) 起向后 lookahead 小时内，
    /// 第一个概率 ≥ threshold 的小时距现在多少小时（0=接下来这一小时，1=下一小时……）；无则 nil。
    /// 盲人看不到天上云层聚集，"约 N 小时后可能下雨"比"今天可能下雨"更能决定现在走还是等（纯逻辑，可单测）。
    public static func hoursUntilLikelyRain(probabilities: [Int?], startIndex: Int,
                                            threshold: Int = 55, lookahead: Int = 4) -> Int? {
        guard startIndex >= 0, startIndex < probabilities.count else { return nil }
        let end = min(startIndex + lookahead, probabilities.count - 1)
        for i in startIndex...end where (probabilities[i] ?? 0) >= threshold { return i - startIndex }
        return nil
    }

    public static func summary(temperature: Double, code: Int,
                               windSpeedKmh: Double? = nil,
                               todayMax: Double? = nil, todayMin: Double? = nil,
                               precipProbability: Int? = nil,
                               uvIndex: Double? = nil,
                               rainInHours: Int? = nil,
                               apparentTemp: Double? = nil,
                               language: Language) -> String {
        let cond = condition(code: code, language: language)
        let t = safeTemp(temperature)
        // 体感温度（风寒/湿热）：盲人看不到日头也感不清风力对体感的影响，与实测差 ≥3°才提（否则赘述）。
        // 非有限体感（异常 API 响应）跳过，绝不报"体感0度"这种假数（safeTemp(NaN)=0 会被 ≥3 差值放行）。
        let feels: Int? = {
            guard let ap = apparentTemp, ap.isFinite else { return nil }
            let f = safeTemp(ap)
            return abs(f - t) >= 3 ? f : nil
        }()
        var parts: [String] = []
        if language == .zh {
            parts.append("现在\(cond)，气温\(t)度")
            if let f = feels { parts.append("体感\(f)度") }
            if let mx = todayMax, let mn = todayMin {
                parts.append("今天最高\(safeTemp(mx))度，最低\(safeTemp(mn))度")
            }
            if let p = precipProbability, p >= 20 { parts.append("降水概率百分之\(p)") }
            if let w = windSpeedKmh, w >= 29 { parts.append("风较大") } // ≥5级（29km/h）才提醒
        } else {
            parts.append("It's \(cond), \(t) degrees")
            if let f = feels { parts.append("feels like \(f)") }
            if let mx = todayMax, let mn = todayMin {
                parts.append("today's high \(safeTemp(mx)), low \(safeTemp(mn))")
            }
            if let p = precipProbability, p >= 20 { parts.append("\(p) percent chance of rain") }
            if let w = windSpeedKmh, w >= 29 { parts.append("quite windy") }
        }
        var text = parts.joined(separator: language == .zh ? "，" : ", ") + (language == .zh ? "。" : ".")
        if let tip = advice(code: code, todayMax: todayMax, todayMin: todayMin,
                            precipProbability: precipProbability, windSpeedKmh: windSpeedKmh,
                            uvIndex: uvIndex, rainInHours: rainInHours, language: language) {
            text += tip
        }
        return text
    }

    /// 盲人出行建议：按对**盲人步行**的危险度排序——冻雨(黑冰)→雾(司机看不清行人)→带伞防滑→
    /// 高温/严寒；并对大风(盖过车流声、盲人靠听觉定向避险的关键被掩)追加安全提示。无建议返回 nil。
    /// windSpeedKmh：单位 km/h（Open-Meteo wind_speed_10m）。
    public static func advice(code: Int, todayMax: Double?, todayMin: Double?,
                              precipProbability: Int?, windSpeedKmh: Double? = nil,
                              uvIndex: Double? = nil, rainInHours: Int? = nil, language: Language) -> String? {
        // 大风安全提示（≥40km/h≈6级"强风"）：盲人靠听觉判断车流/定向，风噪盖过车声是直接的过街危险——
        // 阈值高于描述性"风较大"(29km/h)，只在真会掩盖车声的强风才追加。冻雨已是"避免外出"最高级，不叠加。
        let strongWind = (windSpeedKmh ?? 0) >= 40
        let windTip = language == .zh ? "风很大，可能盖过车流声，过马路请格外留意。"
                                      : " Strong wind may mask traffic sounds — take extra care crossing."

        // 冻雨（WMO 56/57/66/67）＝黑冰天气：雨落地即冻、路面整片成冰，视觉上与湿路无异、盲杖也探不出滑——
        // 对盲人步行是**最危险**的天气。须专门强警告（建议避免外出/有人陪同），不能混进通用"带伞湿滑"。
        let freezing: Set<Int> = [56, 57, 66, 67]
        if freezing.contains(code) {
            return language == .zh ? "现在是冻雨，路面会大面积结冰、极滑，请尽量避免外出；必须出门请找人陪同。"
                                   : " Freezing rain — surfaces will ice over and become extremely slippery. Avoid going out if you can; if you must, take someone with you."
        }

        // 主建议（物理/可见性条件），大风提示随后追加（若有）。
        // windTip 已按语言定型（中文无前导空格接在"。"后；英文带前导空格）——直接拼接。
        func withWind(_ base: String) -> String { strongWind ? base + windTip : base }

        // 雾（WMO 45/48）：盲人自身不靠视觉，但**司机/协助者看不清行人**——过街/路边是被撞风险。
        // 建议走有信号灯的路口、穿浅色/反光衣物、必要时求助。排在带伞之前（可见性安全 > 湿滑舒适）。
        if code == 45 || code == 48 {
            return withWind(language == .zh ? "有雾，来往车辆可能看不清你，过马路请走有信号灯的路口、格外小心。"
                                            : " Foggy — drivers may not see you clearly; cross at signalized crossings and take extra care.")
        }
        let wet: Set<Int> = [51, 53, 55, 61, 63, 65, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]
        if wet.contains(code) {
            // 正在下雨/雪：地面确实湿滑（盲杖用户尤需防滑）。
            return withWind(language == .zh ? "出门请带伞，地面湿滑。" : " Bring an umbrella; the ground is slippery.")
        }
        // 现在没下但很可能下：优先用逐小时得到的**近期时点**（"约 N 小时后"，盲人看不到云层聚集、据此
        // 决定现在走还是等）；无逐小时数据时退回日最高概率的"今天很可能下雨"。均只提醒带伞、不谎称路面已湿滑。
        if let h = rainInHours {
            let tip: String = language == .zh
                ? (h <= 0 ? "接下来一小时内可能下雨，出门记得带伞。" : "预计约\(h)小时后可能下雨，出门记得带伞。")
                : (h <= 0 ? " Rain likely within the hour; bring an umbrella." : " Rain likely in about \(h) hour\(h > 1 ? "s" : ""); bring an umbrella.")
            return withWind(tip)
        }
        if (precipProbability ?? 0) >= 50 {
            return withWind(language == .zh ? "今天很可能下雨，出门记得带伞。" : " Rain is likely today; bring an umbrella.")
        }
        // 高紫外线（Open-Meteo uv_index）：盲人看不到日照强弱，晴天高 UV 下极易在不知不觉中晒伤——
        // ≥6 为 WHO"高"档（约 25 分钟即可致敏），主动提示防晒；与高温常同现（晴热），合并成一句更自然。
        // 落在 fog/wet 之后：阴雨天 UV 本就低，且那些条件的能见度/湿滑安全优先级更高，先返回。
        let highUV = (uvIndex ?? 0) >= 6
        if let mx = todayMax, mx >= 35 {
            return withWind(highUV
                ? (language == .zh ? "今天高温且阳光强烈，注意防暑补水、做好防晒。" : " Very hot with strong sun; stay hydrated and use sun protection.")
                : (language == .zh ? "今天高温，注意防暑补水。" : " Very hot today; stay hydrated."))
        }
        if highUV {
            return withWind(language == .zh ? "紫外线较强，外出请注意防晒（帽子、防晒霜）。" : " High UV; use sun protection (hat, sunscreen) outdoors.")
        }
        if let mn = todayMin, mn <= 0 {
            return withWind(language == .zh ? "气温在冰点以下，路面可能结冰，出行小心。" : " Below freezing; watch for ice.")
        }
        // 无其它条件但强风：单独给大风提示（晴天大风也危险——盲人过街照样听不清车）。
        if strongWind {
            return language == .zh ? "风很大，可能盖过车流声，过马路请格外留意。"
                                   : " Strong wind may mask traffic sounds — take extra care crossing."
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
