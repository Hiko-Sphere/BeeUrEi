import Foundation

/// 把障碍/分级合成播报短语（见 docs/PLAN.md §7.2）。纯字符串逻辑，可单测。
/// 多语言（E5）：所有叶子短语集中在 `SpokenStrings`，方法接受 `language`（默认中文，向后兼容）。
public struct SpeechComposer: Sendable {
    public init() {}

    /// 障碍播报，如「1 点钟方向，行人，约 1.2 米」。
    public func announce(_ o: Obstacle, language: Language = .zh) -> String {
        var parts: [String] = [o.clock.spokenPhrase(in: language)]
        if !o.label.isEmpty { parts.append(o.label) }
        if let d = o.distanceMeters, d.isFinite, d >= 0 {
            parts.append(SpokenStrings.approx(SpokenStrings.meters(d, language), language))
        }
        return parts.joined(separator: SpokenStrings.obstacleSeparator(language))
    }

    /// 简短播报（更快说完、降低认知负荷），如「正前方 行人 1米」。
    public func conciseAnnounce(_ o: Obstacle, language: Language = .zh) -> String {
        var parts: [String] = [o.clock.coarsePhrase(in: language)]
        if !o.label.isEmpty { parts.append(o.label) }
        if let d = o.distanceMeters, d.isFinite, d >= 0 {
            parts.append(SpokenStrings.conciseMeters(d, language))
        }
        return parts.joined(separator: " ")
    }

    public func announce(_ o: Obstacle, concise: Bool, language: Language = .zh) -> String {
        concise ? conciseAnnounce(o, language: language) : announce(o, language: language)
    }

    /// 仅靠深度的近距预警（分类器没认出但很近时），如「正前方很近，请停下」。
    public func announceProximity(_ zone: ProximityZone, nearestMeters: Double?, language: Language = .zh) -> String? {
        switch zone {
        case .clear:
            return nil
        case .caution:
            let metersStr = nearestMeters.map { SpokenStrings.meters($0, language) }
            return SpokenStrings.proximityCaution(metersStr: metersStr, language)
        case .danger:
            return SpokenStrings.proximityDanger(language)
        }
    }

    /// 详细距离文案（暴露给测试；多语言走 SpokenStrings）。
    func formatMeters(_ d: Double, language: Language = .zh) -> String {
        SpokenStrings.meters(d, language)
    }

    func conciseMeters(_ d: Double, language: Language = .zh) -> String {
        SpokenStrings.conciseMeters(d, language)
    }
}
