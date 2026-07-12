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

    /// 距离单位（默认公制）：英语区盲人用英尺/英里思考，可切英制。当前作用于**位置尺度**距离
    /// （"我在哪"/周边 POI/地标）；实时避障近距单独迭代接。存字符串（DistanceUnit.rawValue）。
    private let distanceUnitKey = "feature.distanceUnit"
    var distanceUnit: DistanceUnit {
        get { DistanceUnit(rawValue: defaults.string(forKey: distanceUnitKey) ?? "") ?? .metric }
        set { defaults.set(newValue.rawValue, forKey: distanceUnitKey) }
    }

    /// 绕行侧建议（默认开）：正前方有障碍时，若某一侧**独立读到足够远**且明显更空，附加"左/右侧较空"
    /// 供盲人选绕行方向（对标 biped.ai/WeWALK clear-path 引导，核心 ClearSideAdvisor 保守判定、已测）。
    /// 纯信息性附加、拿不准即静默，不掩盖障碍主警告。想更简洁播报的用户可关。
    private let clearSideHintKey = "feature.clearSideHint"
    var clearSideHint: Bool {
        get { defaults.object(forKey: clearSideHintKey) == nil ? true : defaults.bool(forKey: clearSideHintKey) }
        set { defaults.set(newValue, forKey: clearSideHintKey) }
    }

    /// 震动反馈（默认开）：障碍/转向按危险等级给可区分的震动节奏（HapticFeedback）——嘈杂/不便听语音时的冗余
    /// 安全通道。部分用户嫌震动打扰或想省电可关；与音频提示通道（proximitySonar/spatialObstacleCues）一样可控。
    private let hapticsKey = "feature.hapticsEnabled"
    var hapticsEnabled: Bool {
        get { defaults.object(forKey: hapticsKey) == nil ? true : defaults.bool(forKey: hapticsKey) }
        set { defaults.set(newValue, forKey: hapticsKey) }
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

    /// 用户**自己标记**的过敏原（canonical key 集，如 ["milk","peanuts"]，与 OFF 标签同套）：扫码识物时若产品
    /// 标注命中即额外醒目预警（核心 AllergenAlert 比对）。默认空=不预警。存为排序后的 [String]。安全叠加、不替代
    /// 既有全量过敏原播报。
    private let myAllergensKey = "feature.myAllergens"
    var myAllergens: Set<String> {
        get { Set(defaults.stringArray(forKey: myAllergensKey) ?? []) }
        set { defaults.set(Array(newValue).sorted(), forKey: myAllergensKey) }
    }

    /// 用户**关注**的营养素（canonical key 集，如 ["sugars","salt"]）：扫码识食时若该营养含量 high 即额外醒目预警
    /// （核心 NutrientAlert 比对）。默认空=不预警。糖尿病关注糖、高血压关注盐——安全叠加、不替代既有全量含量播报。
    private let dietWatchKey = "feature.dietWatch"
    var dietWatch: Set<String> {
        get { Set(defaults.stringArray(forKey: dietWatchKey) ?? []) }
        set { defaults.set(Array(newValue).sorted(), forKey: dietWatchKey) }
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
                    "feature.clearPathConfirm", "feature.highContrast", "feature.proximitySonar",
                    // 空间音方向提示：与接近声呐同属"音效播报"偏好、同在设置的同一区，此前漏在恢复默认之外——
                    // 用户关掉它后点"恢复默认"却不复位，与相邻的接近声呐行为不一致。补齐。
                    "feature.spatialObstacleCues", "feature.hapticsEnabled"] {
            defaults.removeObject(forKey: key)
        }
    }
}
