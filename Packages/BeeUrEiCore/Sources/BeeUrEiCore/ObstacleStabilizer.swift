import Foundation

/// 障碍时间稳定化（迟滞），消除手抖/身体抖导致的检测闪烁（见用户反馈）。
///
/// 规则：
/// - 首次检测到 → 立即作为当前目标（不延迟报警）。
/// - 已有目标时来了**不同**目标 → 需连续确认 `confirmFrames` 帧才切换（防抖动误切）。
/// - 某帧没检测到 → 迟滞保留，连续丢失超过 `releaseFrames` 帧才清除。
/// 这样当前目标保持稳定，上层就能"只在目标变化时播报、把话说完"。
public final class ObstacleStabilizer {
    public let confirmFrames: Int
    public let releaseFrames: Int

    private var held: Obstacle?
    private var missCount = 0
    private var candidate: Obstacle?
    private var candidateCount = 0

    public init(confirmFrames: Int = 2, releaseFrames: Int = 3) {
        self.confirmFrames = max(1, confirmFrames)
        self.releaseFrames = max(0, releaseFrames)
    }

    public var current: Obstacle? { held }

    /// 输入这一帧的候选障碍（可 nil），返回当前应播报/展示的稳定障碍（可 nil）。
    @discardableResult
    public func update(_ obstacle: Obstacle?) -> Obstacle? {
        guard let obs = obstacle else {
            missCount += 1
            candidate = nil
            candidateCount = 0
            if missCount > releaseFrames { held = nil }
            return held
        }

        missCount = 0

        if let h = held, Self.isSame(h, obs) {
            held = obs              // 同一目标：刷新距离/方向
            candidate = nil
            candidateCount = 0
            return held
        }

        if held == nil {
            held = obs              // 首次获取，立即生效
            candidate = nil
            candidateCount = 0
            return held
        }

        // 有旧目标但来了不同目标：需连续确认才切换。
        if let c = candidate, Self.isSame(c, obs) {
            candidate = obs
            candidateCount += 1
        } else {
            candidate = obs
            candidateCount = 1
        }
        if candidateCount >= confirmFrames {
            held = obs
            candidate = nil
            candidateCount = 0
        }
        return held
    }

    static func isSame(_ a: Obstacle, _ b: Obstacle) -> Bool {
        a.label == b.label && hourDistance(a.clock.hour, b.clock.hour) <= 1
    }

    /// 时钟点的环形距离（11 与 1 相距 2；12 与 1 相距 1）。
    static func hourDistance(_ a: Int, _ b: Int) -> Int {
        let d = abs(a - b) % 12
        return min(d, 12 - d)
    }
}
