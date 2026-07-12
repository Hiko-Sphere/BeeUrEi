import Foundation

/// 共享位置的 GPS 精度短语（"精确到约 20 米"/"~20 m accuracy"）——盲人查看家人共享位置时靠它判断有多准：
/// 大数=对方"在这一带"、小数=精确，影响对距离/方位的解读。与 web geoAccuracy 同口径：只在**有限正值**时给出，
/// 非有限/≤0（无精度信息）返回 nil、绝不报假精度。用 safeRoundedInt 夹取——accuracy 来自网络，裸 Int() 会溢出崩溃。
public enum SharedLocationAccuracy {
    public static func phrase(accuracyMeters: Double?, language: Language, unit: DistanceUnit = .metric) -> String? {
        guard let a = accuracyMeters, a.isFinite, a > 0 else { return nil }
        // 英制（英语盲人对标 Soundscape 念英尺/英里）：复用 DistanceUnit 的单一换算源（<1000ft 英尺、≥ 英里，
        // 溢出/非有限安全），包进精度措辞。公制分支保持**逐字节不变**（不打扰现有用户）。
        if unit == .imperial {
            let d = DistanceUnit.imperial.farDistance(meters: a, language: language) // farDistance 内部已溢出/非有限安全并夹取
            return language == .zh ? "精确到约\(d)" : "~\(d) accuracy"
        }
        // 夹取上界 1e6 防裸 Int() 溢出崩溃（accuracy 来自网络）；**用夹取后的原始值**判档与算公里，与 web
        // geoAccuracy 逐值同式（阈值 a≥1000、round(a/100)/10）。若像旧版先 round 成米再判档/算公里，会因
        // 二次舍入在 999.5–1000（单位分叉）与各 X49.5–X50（0.1km 分叉）边界与 web 不一，破坏"同口径"承诺。
        let clamped = min(a, 1_000_000) // a>0 已保证下界，无需 max
        // ≥1km（粗/室内网络定位，服务端精度上限 100km）改用**公里**——读屏念"约1.5公里"远胜"约1500米"，
        // 后者听者难快速换算量级。0.1 精度去尾零，与核心 SpokenStrings.locationDistance / web 同公式。
        if clamped >= 1000 {
            let km = (clamped / 100).rounded() / 10 // 四舍五入到 0.1 公里（对原始值，同 web Math.round(a/100)/10）
            let s = km == km.rounded() ? String(Int(km)) : String(format: "%.1f", km) // 2.0→"2" 去尾零
            return language == .zh ? "精确到约\(s)公里" : "~\(s) km accuracy"
        }
        let m = Int(clamped.rounded()) // <1000，clamp 后取整安全
        return language == .zh ? "精确到约\(m)米" : "~\(m) m accuracy"
    }
}
