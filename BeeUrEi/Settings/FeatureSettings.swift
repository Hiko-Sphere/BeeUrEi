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

    /// 空间音方向提示（默认开）：危险障碍播报时，同方位播一声 HRTF 提示音——
    /// 声音本身就是方向，戴 AirPods 时随头转动保持世界固定。
    private let spatialCuesKey = "feature.spatialObstacleCues"
    var spatialObstacleCues: Bool {
        get { defaults.object(forKey: spatialCuesKey) == nil ? true : defaults.bool(forKey: spatialCuesKey) }
        set { defaults.set(newValue, forKey: spatialCuesKey) }
    }

    /// 主页避障屏幕常亮时长（秒）：0 = 永久不息屏（避障持续运行）；>0 = 常亮该秒数后允许系统自动息屏(省电)。
    /// 默认 0（永久不息屏）——避障是安全攸关功能，默认不让它在使用中息屏中断。
    private let keepAwakeKey = "feature.keepAwakeSeconds"
    var keepAwakeSeconds: Int {
        get { defaults.integer(forKey: keepAwakeKey) } // 未设置默认 0 = 永久不息屏
        set { defaults.set(max(newValue, 0), forKey: keepAwakeKey) }
    }

    /// 摔倒/剧烈撞击检测（默认开）：检测到疑似摔倒/车祸且倒计时无人取消时，自动通知绑定亲友。
    private let fallDetectionKey = "feature.fallDetection"
    var fallDetectionEnabled: Bool {
        get { defaults.object(forKey: fallDetectionKey) == nil ? true : defaults.bool(forKey: fallDetectionKey) }
        set { defaults.set(newValue, forKey: fallDetectionKey) }
    }

    /// 播报语言偏好（E5 多语言）："system"=跟随系统、"zh"=中文、"en"=English。默认跟随系统。
    /// 决定盲人实时听到的引导语言（核心 SpokenStrings）与 TTS 选用的嗓音（zh-CN / en-US）。
    private let languageKey = "feature.appLanguage"
    var languagePreference: String {
        get { defaults.string(forKey: languageKey) ?? "system" }
        set { defaults.set(newValue, forKey: languageKey) }
    }

    /// 解析后的播报语言：偏好为 system 时跟随系统首选语言（核心 `Language.resolve`，已测）。
    var language: Language {
        Language.resolve(preference: languagePreference, systemCode: Locale.preferredLanguages.first)
    }

    /// 恢复"播报/无障碍"相关设置为默认（不动避障/导航功能开关与开发者模式）。
    static func resetToDefaults(_ defaults: UserDefaults = .standard) {
        for key in ["feature.conciseAnnouncements", "feature.speechRate", "feature.verbosity",
                    "feature.clearPathConfirm", "feature.highContrast", "feature.proximitySonar"] {
            defaults.removeObject(forKey: key)
        }
    }
}
