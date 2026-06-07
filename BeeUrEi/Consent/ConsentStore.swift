import Foundation

/// 免责知情同意的本地持久化（UserDefaults）。
/// 「是否需要再次完整同意 / 是否只需简短提醒」的判定逻辑用核心 `DisclaimerPolicy`（已单测）。
final class ConsentStore {
    private let defaults: UserDefaults
    private let everKey = "consent.hasEverAccepted"
    private let dateKey = "consent.lastAcceptanceRefDate"
    private let briefKey = "consent.briefReminderSpeechEnabled"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if defaults.object(forKey: briefKey) == nil {
            defaults.set(true, forKey: briefKey)   // 默认开启简短提醒语音
        }
    }

    var hasEverAccepted: Bool { defaults.bool(forKey: everKey) }

    /// 距上次完整同意的天数；从未同意返回极大值（交给 DisclaimerPolicy 判定）。
    var daysSinceLastAcceptance: Double {
        let stored = defaults.double(forKey: dateKey)
        guard stored > 0 else { return .greatestFiniteMagnitude }
        return (Date().timeIntervalSinceReferenceDate - stored) / 86_400
    }

    var briefReminderSpeechEnabled: Bool {
        get { defaults.bool(forKey: briefKey) }
        set { defaults.set(newValue, forKey: briefKey) }
    }

    func recordAcceptance(now: Date = Date()) {
        defaults.set(true, forKey: everKey)
        defaults.set(now.timeIntervalSinceReferenceDate, forKey: dateKey)
    }
}
