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
        // 非有限紧急度（坏深度/TTC 帧 → 1/max(NaN,..)=NaN）净化为 0：NaN 参与 `>` 比较恒 false，会**静默禁掉
        // 打断/升级路**（骤近危险不再抢断当前句），且一旦 commit 进 lastUrgency 会毒化后续所有帧的比较门
        // （对抗复审 LOW）。当 0 处理：坏帧不抢断（无从判定紧急），但绝不毒化——下一个有限帧照常升级打断。
        let urgency = urgency.isFinite ? urgency : 0
        if targetKey == lastKey {
            // 同一目标危险骤升（如车辆/行人快速逼近）：即使正在播报也立即打断更新，
            // 否则会被静音到当前句说完+刷新间隔，盲人可能已撞上（安全攸关，见审查 #1）。
            if urgency > lastUrgency * urgencyMargin {
                commit(targetKey, urgency, now)
                return AnnouncementDecision(announce: true, interrupt: true)
            }
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
