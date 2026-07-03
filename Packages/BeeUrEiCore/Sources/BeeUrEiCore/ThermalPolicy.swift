import Foundation

/// 平台无关的热状态（由适配层从 `ProcessInfo.ThermalState` 映射）。
public enum ThermalLevel: Int, Sendable, Comparable {
    case nominal = 0, fair = 1, serious = 2, critical = 3
    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// 一套降级方案。
public struct ThermalPlan: Sendable, Equatable {
    public let targetFPS: Int
    public let downscale: Bool
    public let useNanoModel: Bool
    public let stopCamera: Bool
    public let advisory: String?

    public init(targetFPS: Int, downscale: Bool, useNanoModel: Bool, stopCamera: Bool, advisory: String?) {
        self.targetFPS = targetFPS
        self.downscale = downscale
        self.useNanoModel = useNanoModel
        self.stopCamera = stopCamera
        self.advisory = advisory
    }
}

/// 热状态分级降级策略（见 docs/PLAN.md §5.4）：过热会触发降频→FPS 抖动甚至卡顿，
/// 对行走中的盲人是直接危险，必须主动降级并在 critical 时安全停机 + 衔接志愿者兜底。
public struct ThermalPolicy: Sendable {
    public init() {}

    /// advisory 按 language 出双语文案（修复前硬编码中文，英文用户过热时会听到中文警告——安全提示必须双语）。
    public func plan(for level: ThermalLevel, language: Language = .zh) -> ThermalPlan {
        switch level {
        case .nominal:
            return ThermalPlan(targetFPS: 15, downscale: false, useNanoModel: false, stopCamera: false, advisory: nil)
        case .fair:
            return ThermalPlan(targetFPS: 10, downscale: false, useNanoModel: false, stopCamera: false, advisory: nil)
        case .serious:
            return ThermalPlan(targetFPS: 8, downscale: true, useNanoModel: true, stopCamera: false, advisory: SpokenStrings.thermalSlowdown(language))
        case .critical:
            return ThermalPlan(targetFPS: 0, downscale: true, useNanoModel: true, stopCamera: true, advisory: SpokenStrings.thermalPausedVolunteer(language))
        }
    }
}
