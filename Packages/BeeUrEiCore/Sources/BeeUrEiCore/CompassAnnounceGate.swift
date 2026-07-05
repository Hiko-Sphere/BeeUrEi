import Foundation

/// 指南针可信度播报去抖（纯逻辑，可单测）。
/// 盲人看不到 iOS 的「图-8」校准 UI——罗盘受磁干扰/未校准时导航音信标会**静默停掉**，盲人既不知为何停、
/// 也不知晃动手机/离开金属即可修复。故须**语音**告知：持续不可信时提示校准，恢复可信时告知已恢复。
/// 只播**持续** ≥ sustainSeconds 的状态变化——避免罗盘在阈值附近抖动时"校准/恢复"来回刷屏。
/// 初始假定可信（announcedReliable=true）：故导航开始后若一直不可信，持续够久也会提示一次校准。
public struct CompassAnnounceGate: Sendable {
    public enum Cue: Equatable, Sendable {
        case none        // 无需播报
        case calibrate   // 持续不可信：提示校准（方向提示已暂停）
        case restored    // 持续恢复可信：告知方向提示恢复
    }

    public let sustainSeconds: TimeInterval
    private var announcedReliable = true       // 上次**已播**的稳定态
    private var pendingReliable: Bool? = nil    // 与已播态不同、正计时确认的候选态
    private var pendingSince: TimeInterval = 0

    public init(sustainSeconds: TimeInterval = 3) { self.sustainSeconds = max(0, sustainSeconds) }

    /// 每次拿到罗盘可信度时调用，返回此刻应播的提示。t 为单调时钟秒。
    public mutating func update(reliable: Bool, at t: TimeInterval) -> Cue {
        if reliable == announcedReliable {
            pendingReliable = nil   // 与已播态一致：取消任何候选计时
            return .none
        }
        // 与已播态不同：开始或延续候选态计时（同候选不重置 pendingSince）。
        if pendingReliable != reliable {
            pendingReliable = reliable
            pendingSince = t
        }
        guard t - pendingSince >= sustainSeconds else { return .none } // 未持续够久：先不播（去抖）
        announcedReliable = reliable
        pendingReliable = nil
        return reliable ? .restored : .calibrate
    }
}
