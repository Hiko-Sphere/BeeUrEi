import Foundation

public struct AnnouncementDecision: Equatable {
    public let announce: Bool
    public let interrupt: Bool
    public static let silent = AnnouncementDecision(announce: false, interrupt: false)
}

/// 承诺式播报策略（解决"说不完"）：
/// - 同一目标正在播报时**不**重复（让它把话说完）；
/// - 同一目标说完且过了刷新间隔才再播一次；
/// - 出现**新目标**：未在说话→直接播；正在说话→仅当**明显更紧急**才打断，否则等说完再播。
public final class AnnouncementPolicy {
    public let refreshInterval: TimeInterval
    public let urgencyMargin: Double

    private var lastKey: String?
    private var lastUrgency: Double = 0
    private var lastAnnounce: TimeInterval = -.greatestFiniteMagnitude

    public init(refreshInterval: TimeInterval = 6, urgencyMargin: Double = 1.3) {
        self.refreshInterval = refreshInterval
        self.urgencyMargin = urgencyMargin
    }

    /// - Parameters:
    ///   - targetKey: 目标标识（用稳定的标签，而非抖动的方位）。
    ///   - urgency: 紧急度（越大越紧急，如 1/距离 或 1/TTC）。
    ///   - isSpeaking: 当前是否正在播报。
    public func decide(targetKey: String, urgency: Double, isSpeaking: Bool, now: TimeInterval) -> AnnouncementDecision {
        if targetKey == lastKey {
            if !isSpeaking, now - lastAnnounce >= refreshInterval {
                commit(targetKey, urgency, now)
                return AnnouncementDecision(announce: true, interrupt: false)
            }
            return .silent
        }
        // 新目标
        if !isSpeaking {
            commit(targetKey, urgency, now)
            return AnnouncementDecision(announce: true, interrupt: false)
        }
        if urgency > lastUrgency * urgencyMargin {
            commit(targetKey, urgency, now)
            return AnnouncementDecision(announce: true, interrupt: true)
        }
        return .silent // 让当前播报说完，说完后下一帧 targetKey≠lastKey 且未在说话 → 再播
    }

    private func commit(_ key: String, _ urgency: Double, _ now: TimeInterval) {
        lastKey = key
        lastUrgency = urgency
        lastAnnounce = now
    }

    public func reset() {
        lastKey = nil
        lastUrgency = 0
        lastAnnounce = -.greatestFiniteMagnitude
    }
}
