import Foundation

/// 导航指令等级（见 docs/PLAN.md §5.3）。
public enum InstructionLevel: Sendable, Equatable {
    case precise   // 可下精确转向 / 过马路指令
    case beacon    // 仅空间音信标 + 路口/地标，让用户自校准
    case none      // 精度太差，不下方向指令
}

/// 定位精度门控：把 `horizontalAccuracy` 当一等公民，决定允许下达哪类指令。
/// 安全红线：低精度**绝不**下达「现在过马路 / 现在转向」这类高确定性指令。
public struct LocationAccuracyGate: Sendable {
    public let preciseMaxMeters: Double
    public let beaconMaxMeters: Double

    public init(preciseMaxMeters: Double = 10, beaconMaxMeters: Double = 20) {
        self.preciseMaxMeters = preciseMaxMeters
        self.beaconMaxMeters = beaconMaxMeters
    }

    public func level(horizontalAccuracyMeters: Double) -> InstructionLevel {
        // CoreLocation 用负值表示无效精度。
        if horizontalAccuracyMeters < 0 { return .none }
        if horizontalAccuracyMeters <= preciseMaxMeters { return .precise }
        if horizontalAccuracyMeters <= beaconMaxMeters { return .beacon }
        return .none
    }

    /// 是否允许高确定性指令（如「现在过马路」）。仅 precise 允许。
    public func allowsHighCertaintyInstruction(horizontalAccuracyMeters: Double) -> Bool {
        level(horizontalAccuracyMeters: horizontalAccuracyMeters) == .precise
    }
}
