import Foundation

/// "前方通畅"周期确认（纯逻辑，可单测）：长时间静默会让盲人不确定系统是否还在工作。
/// 持续通畅时每隔 N 秒返回一次 true（提示"前方通畅"）；刚变通畅不立刻报，遇障即重置。
public final class ClearPathConfirmer {
    public let intervalSeconds: Double
    private var clearSince: TimeInterval?
    private var lastConfirm: TimeInterval = 0

    public init(intervalSeconds: Double = 8) {
        self.intervalSeconds = intervalSeconds
    }

    /// 喂入每帧（是否通畅，当前时间）；返回 true 表示该播报一次"前方通畅"。
    public func update(isClear: Bool, now: TimeInterval) -> Bool {
        guard isClear else { clearSince = nil; return false }
        if clearSince == nil {
            clearSince = now
            lastConfirm = now // 刚变通畅，不立刻报
            return false
        }
        if now - lastConfirm >= intervalSeconds {
            lastConfirm = now
            return true
        }
        return false
    }

    public func reset() {
        clearSince = nil
        lastConfirm = 0
    }
}
