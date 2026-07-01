import Foundation

/// 碰撞时间（TTC）。
public enum TimeToCollision {
    /// TTC 秒 = 距离 / 闭合速度。不接近(速度≤阈值)或距离非法 → nil。
    public static func seconds(distanceMeters d: Double, closingSpeed v: Double) -> Double? {
        guard d.isFinite, d >= 0, v > 0.05 else { return nil }
        return d / v
    }
}

/// 威胁优先级打分（见 §5）：综合 TTC + 距离 + 居中度 + 高危类别。越大越危险。
public struct RiskScore: Sendable {
    public let wTTC: Double
    public let wDistance: Double
    public let wCentral: Double
    public let wHazard: Double

    public init(wTTC: Double = 0.5, wDistance: Double = 0.25, wCentral: Double = 0.15, wHazard: Double = 0.10) {
        self.wTTC = wTTC; self.wDistance = wDistance; self.wCentral = wCentral; self.wHazard = wHazard
    }

    public func score(ttc: Double?, distanceMeters d: Double?, bearingDegrees: Double, isHazard: Bool) -> Double {
        // 安全关键：本分数用于 mostDangerous 的 `<` 比较。任一项为 NaN 都会污染分数——NaN 的比较恒 false，
        // 令 max(by:) 结果不可预测，可能把「最危险」错选/漏选（对盲人是错报或漏报要命障碍）。
        // 故一切非有限输入都兜成「无信息」：ttc/距离→该项 0；bearing→居中度 0。与 BeaconDirection 对
        // 同一 bearingDegrees 的显式 isFinite 守护同口径；不再依赖 max(0,NaN)==0 的隐式参数序（重构易失）。
        // 上游 TimeToCollision/α-β 已守 ttc/距离，此处于 public API 边界再兜一层、并显式守 tracker 未过滤的 bearing。
        let ttcTerm = (ttc.map { $0.isFinite ? 1.0 / max($0, 0.3) : 0 }) ?? 0
        let distTerm = (d.map { $0.isFinite ? 1.0 / max($0, 0.3) : 0 }) ?? 0
        let centralTerm = bearingDegrees.isFinite ? max(0, 1 - abs(bearingDegrees) / 60) : 0
        let hazardTerm = isHazard ? 1.0 : 0
        return wTTC * ttcTerm + wDistance * distTerm + wCentral * centralTerm + wHazard * hazardTerm
    }

    /// 在一组轨迹里挑最危险的（按 score 降序）。
    public func mostDangerous(_ tracks: [ObstacleTrack]) -> ObstacleTrack? {
        tracks.max { a, b in
            score(ttc: a.timeToCollision, distanceMeters: a.distanceMeters, bearingDegrees: a.bearingDegrees, isHazard: a.isHazard)
                < score(ttc: b.timeToCollision, distanceMeters: b.distanceMeters, bearingDegrees: b.bearingDegrees, isHazard: b.isHazard)
        }
    }
}
