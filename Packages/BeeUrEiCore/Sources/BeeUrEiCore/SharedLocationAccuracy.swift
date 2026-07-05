import Foundation

/// 共享位置的 GPS 精度短语（"精确到约 20 米"/"~20 m accuracy"）——盲人查看家人共享位置时靠它判断有多准：
/// 大数=对方"在这一带"、小数=精确，影响对距离/方位的解读。与 web geoAccuracy 同口径：只在**有限正值**时给出，
/// 非有限/≤0（无精度信息）返回 nil、绝不报假精度。用 safeRoundedInt 夹取——accuracy 来自网络，裸 Int() 会溢出崩溃。
public enum SharedLocationAccuracy {
    public static func phrase(accuracyMeters: Double?, language: Language) -> String? {
        guard let a = accuracyMeters, a.isFinite, a > 0 else { return nil }
        let m = SpokenStrings.safeRoundedInt(a) // accuracy 来自网络：夹取 [0,1e6] 防裸 Int() 溢出崩溃
        // ≥1km（粗/室内网络定位，服务端精度上限 100km）改用**公里**——读屏念"约1.5公里"远胜"约1500米"，
        // 后者听者难快速换算量级。此前 iOS 一律用米、与 web geoAccuracy(早已切公里)口径实为不一致；现真正对齐。
        // 0.1 精度去尾零，与核心 SpokenStrings.locationDistance 同公式。
        if m >= 1000 {
            let km = (Double(m) / 100).rounded() / 10 // 四舍五入到 0.1 公里
            let s = km == km.rounded() ? String(Int(km)) : String(format: "%.1f", km) // 2.0→"2" 去尾零
            return language == .zh ? "精确到约\(s)公里" : "~\(s) km accuracy"
        }
        return language == .zh ? "精确到约\(m)米" : "~\(m) m accuracy"
    }
}
