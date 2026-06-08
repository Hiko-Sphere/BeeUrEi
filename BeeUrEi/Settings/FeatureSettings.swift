import Foundation

/// 功能开关（见 PLAN §14.1 Q9）：导航与避障可分别开关。默认避障开、导航关。
struct FeatureSettings {
    private let defaults: UserDefaults
    private let avoidanceKey = "feature.avoidanceEnabled"
    private let navigationKey = "feature.navigationEnabled"
    private let conciseKey = "feature.conciseAnnouncements"
    private let speechRateKey = "feature.speechRate"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var avoidanceEnabled: Bool {
        get { defaults.object(forKey: avoidanceKey) == nil ? true : defaults.bool(forKey: avoidanceKey) }
        set { defaults.set(newValue, forKey: avoidanceKey) }
    }

    var navigationEnabled: Bool {
        get { defaults.bool(forKey: navigationKey) }
        set { defaults.set(newValue, forKey: navigationKey) }
    }

    /// 简短播报（默认开）：更快说完、降低认知负荷。
    var conciseAnnouncements: Bool {
        get { defaults.object(forKey: conciseKey) == nil ? true : defaults.bool(forKey: conciseKey) }
        set { defaults.set(newValue, forKey: conciseKey) }
    }

    /// 语音播报速率 0...1（映射到 AVSpeechUtterance 速率）。默认 0.5。
    var speechRate: Float {
        get { defaults.object(forKey: speechRateKey) == nil ? 0.5 : defaults.float(forKey: speechRateKey) }
        set { defaults.set(min(max(newValue, 0), 1), forKey: speechRateKey) }
    }

    /// 高对比大字状态条（低视力友好：实底深色 + 高亮大字）。默认关。
    private let highContrastKey = "feature.highContrast"
    var highContrast: Bool {
        get { defaults.bool(forKey: highContrastKey) }
        set { defaults.set(newValue, forKey: highContrastKey) }
    }

    /// 接近声呐（倒车雷达式蜂鸣，越近越密）。默认关（部分用户偏好安静）。
    private let proximitySonarKey = "feature.proximitySonar"
    var proximitySonar: Bool {
        get { defaults.bool(forKey: proximitySonarKey) }
        set { defaults.set(newValue, forKey: proximitySonarKey) }
    }

    /// 播报详略：0=安静(只危险) 1=正常(转向+危险) 2=详细(全部)。默认 2。
    private let verbosityKey = "feature.verbosity"
    var verbosity: Int {
        get { defaults.object(forKey: verbosityKey) == nil ? 2 : defaults.integer(forKey: verbosityKey) }
        set { defaults.set(min(max(newValue, 0), 2), forKey: verbosityKey) }
    }

    /// 前方持续通畅时定期播报"前方通畅"给予确信（默认关，部分用户偏好安静）。
    private let clearConfirmKey = "feature.clearPathConfirm"
    var clearPathConfirm: Bool {
        get { defaults.bool(forKey: clearConfirmKey) }
        set { defaults.set(newValue, forKey: clearConfirmKey) }
    }

    /// 恢复"播报/无障碍"相关设置为默认（不动避障/导航功能开关与开发者模式）。
    static func resetToDefaults(_ defaults: UserDefaults = .standard) {
        for key in ["feature.conciseAnnouncements", "feature.speechRate", "feature.verbosity",
                    "feature.clearPathConfirm", "feature.highContrast", "feature.proximitySonar"] {
            defaults.removeObject(forKey: key)
        }
    }
}
