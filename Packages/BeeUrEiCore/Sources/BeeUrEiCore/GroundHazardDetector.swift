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
/// LiDAR 深度图按下方中央竖直列采样得到；无效命中为非有限或 ≤0）。
/// 逻辑：平地上该序列平滑递增；**突然大幅变远或射线打空** = 落差；**突然变近** = 竖直面/台阶。
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
            let valid = s.isFinite && s > 0
            guard valid else {
                // 射线打空（地面在此处消失）→ 落差（从上一有效近点起）。
                if let p = prev { return .dropOff(distanceMeters: p) }
                continue
            }
            if let p = prev {
                let delta = s - p
                if delta > dropThreshold && s > p * dropRatio {
                    return .dropOff(distanceMeters: p)
                }
                if delta < -stepUpThreshold {
                    return .stepUp(distanceMeters: s)
                }
            }
            prev = s
        }
        return .none
    }

    /// 安全播报语（偏保守、简短）。
    public func hint(_ hazard: GroundHazard) -> String? {
        switch hazard {
        case .dropOff(let d): return "注意，前方约\(meters(d))有落差或下台阶"
        case .stepUp(let d):  return "注意，前方约\(meters(d))有台阶"
        case .none:           return nil
        }
    }

    private func meters(_ d: Double) -> String {
        if d < 0.5 { return "半米" }
        return "\(Int(d.rounded()))米"
    }
}
