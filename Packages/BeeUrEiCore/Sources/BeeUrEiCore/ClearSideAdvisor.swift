import Foundation

/// 绕行侧建议（纯逻辑，可单测）：正前方有障碍时，**信息性**告知哪一侧更空
///（"左侧较空"/"右侧较空"），供盲人选择绕行方向——对标 biped.ai / WeWALK 的"clear-path"引导。
///
/// 安全设计（与全库"拿不准不误报"一致，误报后果严重故从严）：
/// - **只在一侧独立读到足够远（clearThreshold）时才推荐**——不是"比另一侧空一点"，而是那一侧**本身**够走。
///   nearestDistance 语义：该侧最近障碍距离；无有效读数（玻璃/镜面/超量程盲区）返回 nil。
///   nil **绝不**当作"空"（分不清"真开阔"与"读不到"，与 isConfirmedClear 同哲学）——保守视为不可信、不推荐该侧。
/// - **且须明显比另一侧空**（marginMeters）：两侧接近时不乱指（左右都差不多就别添噪、让用户自己探）。
/// - 建议是**信息性**（"较空"）而非命令式（不说"向左走"）：绝不替用户做决定、绝不掩盖"前方有障碍"主警告。
/// - 拿不准（两侧都不够空、都不可信、或差距不够）→ `.none`：静默，只保留原障碍警告（严格附加、失败向静默）。
///
/// ⚠️ 阈值为保守缺省，真机（LiDAR iPhone）标定后可调——绕行引导是实时安全路径。
public struct ClearSideAdvisor: Sendable {
    public enum Side: Equatable, Sendable { case left, right, none }

    /// 该侧最近障碍须 ≥ 此距离才算"够空可绕"（米）。默认 2.5m：一步跨出+转身的余量，偏保守。
    public let clearThreshold: Double
    /// 且须比另一侧多出的余量（米）。默认 1.2m：防两侧接近时抖动乱指。
    public let marginMeters: Double

    public init(clearThreshold: Double = 2.5, marginMeters: Double = 1.2) {
        self.clearThreshold = max(0, clearThreshold)
        self.marginMeters = max(0, marginMeters)
    }

    /// leftNearest/rightNearest：左右区最近障碍距离（米），nil=该侧无有效读数（不可信）。
    public func suggest(leftNearest: Double?, rightNearest: Double?) -> Side {
        let l = clearance(leftNearest)
        let r = clearance(rightNearest)
        // 只推荐**本身够空**且**明显更空**的一侧；否则静默。两侧都够空且相近 → 不指（用户自选，别添噪）。
        if l >= clearThreshold, l >= r + marginMeters { return .left }
        if r >= clearThreshold, r >= l + marginMeters { return .right }
        return .none
    }

    /// 无读数/坏值 → 0（不可信，绝不当"空"）；有效正读数原样返回。
    private func clearance(_ d: Double?) -> Double {
        guard let d, d.isFinite, d >= 0 else { return 0 }
        return d
    }

    /// 跟踪到具体障碍时的**一致性护栏**（纯逻辑）：绕行侧必须**背离障碍**——否则会把盲人引向障碍那一侧。
    /// 障碍偏右（bearing > deadZone）只许荐左、偏左只许荐右；建议与障碍同侧＝矛盾 → 抑制为 .none。
    /// 障碍近正前方（|bearing| ≤ deadZone）：两侧皆背离，不额外设限。坏 bearing → 不设限（advisor 本身已保守）。
    /// bearing 约定：右为正、左为负、0=正前方（ClockDirection.angleDegrees 同）。
    public func awayFromObstacle(_ side: Side, obstacleBearingDegrees b: Double, deadZone: Double = 8) -> Side {
        guard b.isFinite else { return side }
        if b > deadZone { return side == .left ? .left : .none }
        if b < -deadZone { return side == .right ? .right : .none }
        return side
    }

    /// 建议的播报后缀（信息性，附加在障碍警告之后）；`.none` → nil（不添噪）。
    public func hintSuffix(_ side: Side, language: Language = .zh) -> String? {
        switch side {
        case .left: return language == .zh ? "，左侧较空" : ", more open on your left"
        case .right: return language == .zh ? "，右侧较空" : ", more open on your right"
        case .none: return nil
        }
    }
}
