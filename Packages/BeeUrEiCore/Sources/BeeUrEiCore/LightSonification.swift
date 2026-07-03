import Foundation

/// 连续光探测音调映射（Seeing AI Light / Envision 式）：把画面亮度实时映射成音调——
/// 越亮音越高、蜂鸣越密（金属探测器式"越接近越热"）。让盲人扫动手机、靠耳朵定位窗户/灯/亮着的出口，
/// 而不只是一次性听"明亮/昏暗"。纯逻辑、可单测；实际发声复用已真机验证的 ProximitySonifier(ProximityCue)。
public enum LightSonification {
    /// 把亮度 [0,1] 映射成蜂鸣 cue。非有限/越界输入夹到 [0,1]（坏采样不炸、不失声）。
    /// - pitch：暗 300Hz → 亮 1600Hz（人耳易辨的升调）。
    /// - interval：暗 0.5s（慢滴答）→ 亮 0.06s（快到近乎连续），越亮越密。
    public static func cue(brightness: Double,
                           minPitchHz: Double = 300, maxPitchHz: Double = 1600,
                           slowIntervalSeconds: Double = 0.5, fastIntervalSeconds: Double = 0.06) -> ProximityCue {
        let b = brightness.isFinite ? min(1, max(0, brightness)) : 0
        let pitch = minPitchHz + (maxPitchHz - minPitchHz) * b
        // interval 随亮度线性缩短（越亮越密）。
        let interval = slowIntervalSeconds + (fastIntervalSeconds - slowIntervalSeconds) * b
        return ProximityCue(beepIntervalSeconds: interval, pitchHz: pitch)
    }
}
