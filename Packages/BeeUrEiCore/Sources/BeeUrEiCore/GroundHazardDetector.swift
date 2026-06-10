import Foundation

/// 地面高危地形：落差/下台阶/坑（向下）或台阶/路缘/竖直障碍（向上）。
public enum GroundHazard: Equatable, Sendable {
    case none
    case dropOff(distanceMeters: Double)  // 下台阶/落差/坑：地面突然变远或消失
    case stepUp(distanceMeters: Double)    // 上台阶/路缘/障碍：地面突然变近(竖直面)
}

/// 纯 LiDAR 几何的地面高危检测（COCO 分类模型识别不了的"脚下"危险，见 BACKLOG B4）。
///
/// 输入：沿"预期地面线"从近到远、等角度采样的**地面命中距离(米)**（由 iOS 适配层从
/// LiDAR 深度图按下方中央竖直列采样、并用置信度过滤后得到；未知/低置信记为非有限或 ≤0）。
/// 逻辑：平地上可靠样本平滑递增；可靠样本间**突然大幅变远** = 落差/下台阶；**突然变近** = 竖直面/台阶。
/// 未知/低置信样本一律跳过（LiDAR 在深色/湿滑地面常读不到，不能当作落差，见审查 #7）。
/// 纯逻辑、可单测；阈值真机可调。
public struct GroundHazardDetector: Sendable {
    public let dropThreshold: Double   // 相邻样本绝对跳变(米) → 落差
    public let dropRatio: Double       // 相邻样本相对跳变倍数 → 落差（抗透视）
    public let stepUpThreshold: Double // 地面回退(米) → 上台阶/竖直面
    public let minValidSamples: Int

    public init(dropThreshold: Double = 0.4, dropRatio: Double = 1.4,
                stepUpThreshold: Double = 0.3, minValidSamples: Int = 3) {
        self.dropThreshold = dropThreshold
        self.dropRatio = dropRatio
        self.stepUpThreshold = stepUpThreshold
        self.minValidSamples = minValidSamples
    }

    public func detect(groundProfile samples: [Double]) -> GroundHazard {
        let validCount = samples.filter { $0.isFinite && $0 > 0 }.count
        guard validCount >= minValidSamples else { return .none }

        var prev: Double?
        for s in samples {
            // 未知/低置信样本（非有限或 ≤0）：LiDAR 在深色/湿滑/镜面/超量程地面经常返回 0，
            // 这些是"读不到"而非"真有坑"。绝不据此误报落差——否则盲人会在正常路面/过街时被误报
            // 而突然僵立，本身就是危险动作（见审查 #7）。直接跳过，不破坏 prev 连续性。
            guard s.isFinite, s > 0 else { continue }
            if let p = prev {
                let delta = s - p
                // 落差：可靠样本间地面突然变远（下台阶/路缘时 LiDAR 看到更低更远的地面 → 不连续）。
                if delta > dropThreshold && s > p * dropRatio {
                    return .dropOff(distanceMeters: p)
                }
                // 上台阶/竖直面：地面突然变近。
                if delta < -stepUpThreshold {
                    return .stepUp(distanceMeters: s)
                }
            }
            prev = s
        }
        return .none
    }

    /// 安全播报语（偏保守、简短；语言可选，默认中文）。
    public func hint(_ hazard: GroundHazard, language: Language = .zh) -> String? {
        switch hazard {
        case .dropOff(let d): return SpokenStrings.groundDropOff(metersStr: SpokenStrings.groundMeters(d, language), language)
        case .stepUp(let d):  return SpokenStrings.groundStepUp(metersStr: SpokenStrings.groundMeters(d, language), language)
        case .none:           return nil
        }
    }
}
