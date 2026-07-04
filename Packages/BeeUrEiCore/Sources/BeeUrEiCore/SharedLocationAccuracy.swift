import Foundation

/// 共享位置的 GPS 精度短语（"精确到约 20 米"/"~20 m accuracy"）——盲人查看家人共享位置时靠它判断有多准：
/// 大数=对方"在这一带"、小数=精确，影响对距离/方位的解读。与 web geoAccuracy 同口径：只在**有限正值**时给出，
/// 非有限/≤0（无精度信息）返回 nil、绝不报假精度。用 safeRoundedInt 夹取——accuracy 来自网络，裸 Int() 会溢出崩溃。
public enum SharedLocationAccuracy {
    public static func phrase(accuracyMeters: Double?, language: Language) -> String? {
        guard let a = accuracyMeters, a.isFinite, a > 0 else { return nil }
        let m = SpokenStrings.safeRoundedInt(a)
        return language == .zh ? "精确到约\(m)米" : "~\(m) m accuracy"
    }
}
