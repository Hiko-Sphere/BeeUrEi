import Foundation

/// 公交/地铁出行方案（来自服务端 /api/nav/transit，字段与其 JSON 一一对应，App 直接解码进这些类型）。
/// 一段腿：步行 / 公交 / 地铁 / 火车。数值米/秒（服务端已把高德的字符串数值转安全非负数）。
public enum TransitLegKind: String, Decodable, Sendable {
    case walk, bus, subway, railway
}

public struct TransitLeg: Decodable, Sendable, Equatable {
    public let kind: TransitLegKind
    public let line: String?       // 线路名（"地铁1号线"/"300路"/车次）
    public let fromStop: String?   // 上车站
    public let toStop: String?     // 下车站
    public let stops: Int?         // 乘坐站数（含到站）
    public let distanceMeters: Double
    public let durationSeconds: Double
    public init(kind: TransitLegKind, line: String?, fromStop: String?, toStop: String?,
                stops: Int?, distanceMeters: Double, durationSeconds: Double) {
        self.kind = kind; self.line = line; self.fromStop = fromStop; self.toStop = toStop
        self.stops = stops; self.distanceMeters = distanceMeters; self.durationSeconds = durationSeconds
    }
}

public struct TransitPlan: Decodable, Sendable, Equatable {
    public let durationSeconds: Double
    public let walkingDistanceMeters: Double
    public let legs: [TransitLeg]
    public init(durationSeconds: Double, walkingDistanceMeters: Double, legs: [TransitLeg]) {
        self.durationSeconds = durationSeconds; self.walkingDistanceMeters = walkingDistanceMeters; self.legs = legs
    }
}

/// 把公交方案组织成一段可听的中/英文播报（纯逻辑，可单测）。盲人看不到导航地图，全程只能靠这段话建立心理路线：
/// 总时长/步行 → 逐段"步行N米 / 乘(换)线路 从X站上车 坐N站到Y站下车"。**上/下车站名是最关键信息**
/// （盲人靠车内报站判断何时下车），故即便站数口径有±1 也不致误事——站名始终准确。
public enum TransitPlanFormatter {
    public static func summary(_ plan: TransitPlan, language: Language) -> String {
        let zh = language == .zh
        let mins = max(1, Int((plan.durationSeconds / 60).rounded()))
        let walkM = Int(max(0, plan.walkingDistanceMeters).rounded())
        let header = zh ? "全程约\(mins)分钟，步行共\(walkM)米。"
                        : "About \(mins) minutes total, \(walkM) meters of walking. "

        var parts: [String] = []
        var hasRidden = false // 第一段乘车用"乘坐"，其后用"换乘"
        for (i, leg) in plan.legs.enumerated() {
            let isLast = i == plan.legs.count - 1
            let m = Int(max(0, leg.distanceMeters).rounded())
            switch leg.kind {
            case .walk:
                if zh { parts.append(isLast ? "步行\(m)米到达" : "步行\(m)米") }
                else { parts.append(isLast ? "walk \(m) meters to arrive" : "walk \(m) meters") }
            case .bus, .subway:
                let line = (leg.line?.trimmingCharacters(in: .whitespaces)).flatMap { $0.isEmpty ? nil : $0 }
                    ?? (leg.kind == .subway ? (zh ? "地铁" : "the subway") : (zh ? "公交" : "a bus"))
                let verbZh = hasRidden ? "换乘" : "乘坐"
                let verbEn = hasRidden ? "transfer to" : "take"
                hasRidden = true
                if zh {
                    var s = "\(verbZh)\(line)"
                    if let f = clean(leg.fromStop) { s += "，\(f)上车" }
                    if let stops = leg.stops, stops > 0 { s += "，坐\(stops)站" }
                    if let t = clean(leg.toStop) { s += (leg.stops ?? 0) > 0 ? "到\(t)下车" : "，\(t)下车" }
                    parts.append(s)
                } else {
                    var s = "\(verbEn) \(line)"
                    if let f = clean(leg.fromStop) { s += " from \(f)" }
                    if let stops = leg.stops, stops > 0 { s += ", ride \(stops) stop\(stops == 1 ? "" : "s")" }
                    if let t = clean(leg.toStop) { s += " to \(t)" }
                    parts.append(s)
                }
            case .railway:
                let line = clean(leg.line) ?? (zh ? "火车" : "the train")
                var s = zh ? "乘坐\(line)" : "take \(line)"
                if let f = clean(leg.fromStop) { s += zh ? "，\(f)上车" : " from \(f)" }
                if let t = clean(leg.toStop) { s += zh ? "到\(t)下车" : " to \(t)" }
                hasRidden = true
                parts.append(s)
            }
        }
        let sep = zh ? "，" : ", "
        let tail = zh ? "。" : "."
        return header + parts.joined(separator: sep) + tail
    }

    private static func clean(_ s: String?) -> String? {
        guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        return t
    }
}
