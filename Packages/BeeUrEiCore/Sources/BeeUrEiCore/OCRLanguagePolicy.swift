import Foundation

/// 端侧 OCR（Vision VNRecognizeTextRequest）识别语言的优先序（纯逻辑，可单测）。
///
/// 覆盖 **简体中文 zh-Hans + 繁体中文 zh-Hant + 英文 en-US**。繁体中文（台湾/港澳及海外华人，
/// 4000 万+ 使用者）此前**缺失**——Vision 只被告知识别 zh-Hans/en-US，扫繁体菜单/招牌/药盒/公交牌
/// 会把繁体字误识成相近简体或英文＝乱码，对当地盲人是核心 OCR 能力（读字/读日期/读电话/识公交）失效。
/// 简繁字形大量重叠、Vision 同时支持二者，加 zh-Hant 低风险且是标配（Apple 自家 Live Text 亦如此）。
///
/// 顺序＝Vision 的识别**优先提示**：按界面语言把用户主用语言排最前（中文界面简中优先、英文界面英文优先），
/// 但三种始终都在（在华英文用户也要扫中文、繁中界面用户扫简体招牌）。
public enum OCRLanguagePolicy {
    public static func recognitionLanguages(interfaceLanguage: Language) -> [String] {
        interfaceLanguage == .en
            ? ["en-US", "zh-Hans", "zh-Hant"]
            : ["zh-Hans", "zh-Hant", "en-US"]
    }
}
