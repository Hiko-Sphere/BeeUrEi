import Foundation

/// 播报去抖节流（见 docs/PLAN.md §5.1「警报疲劳」）：同一类提示在 `minGap` 内只播一次，
/// 避免频繁重复让用户忽视真警报。按 key 分别计时。
public struct AnnouncementThrottle {
    private var lastTimes: [String: TimeInterval] = [:]

    public init() {}

    /// 是否允许在 `now`（秒）播报该 key（距上次 ≥ minGap）。允许则记录本次时间。
    public mutating func shouldAnnounce(key: String, now: TimeInterval, minGap: TimeInterval) -> Bool {
        if let last = lastTimes[key], now - last < minGap {
            return false
        }
        lastTimes[key] = now
        return true
    }

    public mutating func reset() {
        lastTimes.removeAll()
    }
}
