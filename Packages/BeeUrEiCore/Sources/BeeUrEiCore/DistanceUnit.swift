import Foundation

/// 距离单位（纯逻辑，可单测）：公制（米/公里）或英制（英尺/英里）。英语区（美/英/加）盲人用**英尺/英里**
/// 思考，每次听"1.5 米/1.5 公里"都要心算换算——对标 Soundscape/WeWALK 等提供英制。默认公制（不打扰
/// 现有用户），英语用户可在设置切换。本类型只负责**格式化**，换算系数固定精确，溢出/非有限安全。
///
/// 本迭代先接**位置尺度**距离（"我在哪"/周边 POI/地标——非实时避障告警）：单位切换低风险、语义自洽。
/// 实时避障近距（"正前方 X 米"）刻意留作单独的谨慎迭代（安全攸关，需真机核阈值），不在此半接。
public enum DistanceUnit: String, Sendable, CaseIterable {
    case metric   // 米 / 公里
    case imperial // 英尺 / 英里

    private static let metersPerFoot = 0.3048
    private static let metersPerMile = 1609.344

    /// 位置尺度距离（可达数百米~数公里）的可听表达。公制 ≥1km 用公里否则米；英制 ≥1000ft 用英里否则英尺。
    /// 用**完整单位词**（TTS 清晰："mi"可能被念错）。返回数值+单位（不含"约"，调用方按语境加）。
    /// 溢出/非有限安全：公制沿用 safeRoundedInt（夹 [0,1_000_000]）；英制同样先夹再换算。
    public func farDistance(meters: Double, language: Language) -> String {
        let m = Double(SpokenStrings.safeRoundedInt(meters)) // 非有限/负→0，夹到 1000km
        switch self {
        case .metric:
            if m >= 1000 {
                let km = (m / 100).rounded() / 10                 // 0.1 公里
                let s = km == km.rounded() ? String(Int(km)) : String(format: "%.1f", km)
                // 恰 "1" 用单数 kilometer（"1 kilometers" 是语病；分数如 "1.2 kilometers" 仍复数）。中文无复数。
                return language == .zh ? "\(s)公里" : "\(s) kilometer\(s == "1" ? "" : "s")"
            }
            return language == .zh ? "\(Int(m))米" : "\(Int(m)) meter\(Int(m) == 1 ? "" : "s")"
        case .imperial:
            let feet = m / DistanceUnit.metersPerFoot
            if feet >= 1000 {
                let miles = (m / DistanceUnit.metersPerMile * 10).rounded() / 10  // 0.1 英里
                let s = miles == miles.rounded() ? String(Int(miles)) : String(format: "%.1f", miles)
                return language == .zh ? "\(s)英里" : "\(s) mile\(s == "1" ? "" : "s")"
            }
            let ft = Int(feet.rounded())
            // 恒复数 feet：入参 meters 先取整到米（safeRoundedInt），1 米≈3.28 英尺 → ft 取值恒 ∈{0,3,7,…}，
            // 永不为 1（"1 foot" 不可达），故无需单数分支。
            return language == .zh ? "\(ft)英尺" : "\(ft) feet"
        }
    }

    /// 近距转向提示（turn-by-turn）的英尺档：把换算后的英尺**吸附到最近的 5 英尺整档**（下限 5 英尺），
    /// 令英制用户听到 15 / 35 / 50 / 65 这类整档，而非 farDistance 逐英尺取整得到的 16 / 33 / 49 / 66
    /// 伪精确碎数——与公制侧「5 米整档、跨档才变」同样"离散不刷屏"的初衷一致（对标 Soundscape / WeWALK）。
    /// 仅用于 RouteProgress 已取到 5 米档的近距（量级 ≤ announceWithinMeters）；位置尺度距离（含英里滚动）
    /// 仍走 farDistance，勿在此处理。溢出/非有限先经 safeRoundedInt 夹紧（负/坏值→0→下限 5 英尺）。
    static func maneuverFeet(meters: Double) -> Int {
        let m = Double(SpokenStrings.safeRoundedInt(meters))
        let snapped = (m / metersPerFoot / 5).rounded() * 5
        return max(5, Int(snapped))
    }
}
