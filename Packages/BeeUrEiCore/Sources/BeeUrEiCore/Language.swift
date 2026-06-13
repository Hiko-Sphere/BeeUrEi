import Foundation

/// 应用语言（i18n / E5「出海硬门槛」）。先支持中文+英文，结构上加语言只需扩 `Localized` 表与本枚举。
///
/// 这是**播报文案**（盲人实际听到的实时引导：障碍/落差/场景/颜色/转向/过街/免责）的语言开关。
/// 纯逻辑、平台无关，可用 `swift test` 全量验证英文输出。UI 文案的本地化走 SwiftUI String Catalog（另行）。
public enum Language: String, Sendable, CaseIterable {
    case zh
    case en

    /// 从 BCP-47 语言代码（如 "zh-Hans-CN"/"en-US"）解析。非中文一律按英文（默认出海语言）。
    public static func from(code: String?) -> Language {
        guard let code = code?.lowercased() else { return .zh }
        if code.hasPrefix("zh") { return .zh }
        if code.hasPrefix("en") { return .en }
        // 其余语言暂未翻译：回退英文而非中文（英文是更通用的国际兜底）。
        return .en
    }

    /// 用户偏好解析：preference 为 "system" 时跟随系统首选语言；否则按显式 "zh"/"en"。
    /// `systemCode` 由调用方注入（iOS 传 `Locale.preferredLanguages.first`），保证纯函数可测。
    public static func resolve(preference: String?, systemCode: String?) -> Language {
        switch preference {
        case "zh": return .zh
        case "en": return .en
        default:   return from(code: systemCode)   // "system"/nil/未知 → 跟随系统
        }
    }

    /// 对应 AVSpeechSynthesisVoice 的 BCP-47 语音代码（端侧 TTS 选对应语言嗓音）。
    public var voiceCode: String {
        switch self {
        case .zh: return "zh-CN"
        case .en: return "en-US"
        }
    }

    /// 用于 Foundation 本地化（日期格式化 / 反查地名 CLGeocoder.locale）的 Locale 标识。
    /// 避免各处硬编码 `zh_CN`，让英文用户看到英文日期/地名。
    public var localeIdentifier: String {
        switch self {
        case .zh: return "zh_CN"
        case .en: return "en_US"
        }
    }
}
