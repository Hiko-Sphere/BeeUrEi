import Foundation

/// 把障碍/分级合成中文播报短语（见 docs/PLAN.md §7.2）。纯字符串逻辑，可单测。
public struct SpeechComposer: Sendable {
    public init() {}

    /// 障碍播报，如「1 点钟方向，行人，约 1.2 米」。
    public func announce(_ o: Obstacle) -> String {
        var parts: [String] = [o.clock.spokenPhrase]
        if !o.label.isEmpty { parts.append(o.label) }
        if let d = o.distanceMeters, d.isFinite, d >= 0 {
            parts.append("约 \(formatMeters(d))")
        }
        return parts.joined(separator: "，")
    }

    /// 简短播报（更快说完、降低认知负荷），如「正前方 行人 1米」。
    public func conciseAnnounce(_ o: Obstacle) -> String {
        var parts: [String] = [o.clock.coarsePhrase]
        if !o.label.isEmpty { parts.append(o.label) }
        if let d = o.distanceMeters, d.isFinite, d >= 0 {
            parts.append(conciseMeters(d))
        }
        return parts.joined(separator: " ")
    }

    func conciseMeters(_ d: Double) -> String {
        if d < 0.5 { return "很近" }
        if d < 1 { return "半米" }
        return "\(Int(d.rounded()))米"
    }

    public func announce(_ o: Obstacle, concise: Bool) -> String {
        concise ? conciseAnnounce(o) : announce(o)
    }

    /// 仅靠深度的近距预警（分类器没认出但很近时），如「正前方很近，请停下」。
    public func announceProximity(_ zone: ProximityZone, nearestMeters: Double?) -> String? {
        switch zone {
        case .clear:
            return nil
        case .caution:
            if let d = nearestMeters { return "前方约 \(formatMeters(d)) 有障碍" }
            return "前方有障碍"
        case .danger:
            return "正前方很近，请停下"
        }
    }

    func formatMeters(_ d: Double) -> String {
        // 非法/退化距离（NaN/∞/≤0/四舍五入到 0cm）退化为「非常近」，避免「0 厘米/-50 厘米/nan 米」。
        guard d.isFinite, d > 0 else { return "非常近" }
        let cm = Int((d * 100).rounded())
        if cm <= 0 { return "非常近" }
        // ≥100cm（含 0.995…0.999 进位到 100）一律用「米」，避免「100 厘米」。
        if cm < 100 { return "\(cm) 厘米" }
        return String(format: "%.1f 米", d)
    }
}
