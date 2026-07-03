import Foundation

/// 语速调节方向（语音指令"说快点/说慢点/正常语速"解析结果）。
public enum SpeechRateAdjust: Sendable, Equatable {
    case faster, slower, normal
}

/// 语音调语速的纯策略（可单测）：盲人找设置滑块成本高，语速又是最常想即时调的——
/// 播报太快听不清、太慢嫌啰嗦。本策略把每次"说快点/说慢点"折算成一档，并**夹在可懂区间**内
/// （连说几次"快点"也不会冲到听不清的极速；设置滑块仍可全程 0…1 供高级用户）。
///
/// FeatureSettings.speechRate ∈ [0,1]（AVSpeech 归一化：0=最慢、1=最快、0.5≈默认）。
/// 语音调节只在 [0.3, 0.7] 步进 0.1——低于 0.3 拖沓、高于 0.7 含糊，都非日常可用档。
public enum SpeechRatePolicy {
    public static let minRate: Float = 0.3
    public static let maxRate: Float = 0.7
    public static let normalRate: Float = 0.5
    public static let step: Float = 0.1

    /// 返回调整后的语速（夹到可懂区间、按 0.1 档对齐，规避 Float 累加漂移）。
    public static func adjusted(from current: Float, _ adjust: SpeechRateAdjust) -> Float {
        switch adjust {
        case .normal: return normalRate
        case .faster: return snap(min(maxRate, snap(current) + step))
        case .slower: return snap(max(minRate, snap(current) - step))
        }
    }

    /// 该方向是否已到边界（用于"已经最快了/最慢了"提示，不做无效播报）。
    /// current 先夹进可懂区间再判——设置滑块可能停在区间外（如 0.9），语音"再快点"应视为已达上限。
    public static func atLimit(_ current: Float, _ adjust: SpeechRateAdjust) -> Bool {
        let c = snap(min(maxRate, max(minRate, current)))
        switch adjust {
        case .faster: return c >= maxRate
        case .slower: return c <= minRate
        case .normal: return false // "正常语速"总有效（即便已在 normal，重申无害）
        }
    }

    /// 对齐到 0.1 档：Float 累加（0.5+0.1=0.60000002）会让边界判定与去重失真，四舍五入到一位小数。
    private static func snap(_ v: Float) -> Float {
        (v * 10).rounded() / 10
    }
}
