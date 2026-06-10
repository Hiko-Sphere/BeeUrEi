import Foundation

/// 一条转向播报决策。
public struct ManeuverAnnouncement: Sendable, Equatable {
    public let shouldAnnounce: Bool
    public let text: String?
    /// 是否是「现在过马路/现在转向」这类高确定性指令。
    public let isHighCertainty: Bool

    public init(shouldAnnounce: Bool, text: String?, isHighCertainty: Bool) {
        self.shouldAnnounce = shouldAnnounce
        self.text = text
        self.isHighCertainty = isHighCertainty
    }

    static let silent = ManeuverAnnouncement(shouldAnnounce: false, text: nil, isHighCertainty: false)
}

/// 到下一转向的播报决策（见 docs/PLAN.md §5.3）。
/// 安全红线：低定位精度（非 precise）时**绝不**下达「现在……」这类高确定性指令。
public struct RouteProgress: Sendable {
    public let announceWithinMeters: Double
    public let imminentMeters: Double

    public init(announceWithinMeters: Double = 20, imminentMeters: Double = 5) {
        self.announceWithinMeters = announceWithinMeters
        self.imminentMeters = imminentMeters
    }

    public func decide(distanceToManeuverMeters: Double,
                       instruction: String,
                       level: InstructionLevel,
                       language: Language = .zh) -> ManeuverAnnouncement {
        // 精度太差：不下任何方向指令。
        guard level != .none else { return .silent }
        // 已越过转向点（GPS 抖动/回放延迟/卫星回跳导致负距离）：绝不下达高确定性「现在……」。
        guard distanceToManeuverMeters >= 0 else { return .silent }
        // 还很远：先不播。
        guard distanceToManeuverMeters <= announceWithinMeters else { return .silent }

        if distanceToManeuverMeters <= imminentMeters {
            if level == .precise {
                // 仅高精度允许「现在……」。
                return ManeuverAnnouncement(shouldAnnounce: true, text: SpokenStrings.maneuverNow(instruction, language), isHighCertainty: true)
            } else {
                // 信标级精度：给提示但不下高确定性「现在」。
                return ManeuverAnnouncement(shouldAnnounce: true, text: SpokenStrings.maneuverSoon(instruction, language), isHighCertainty: false)
            }
        }

        let meters = Int(distanceToManeuverMeters.rounded())
        return ManeuverAnnouncement(shouldAnnounce: true, text: SpokenStrings.maneuverInMeters(meters, instruction: instruction, language), isHighCertainty: false)
    }
}
