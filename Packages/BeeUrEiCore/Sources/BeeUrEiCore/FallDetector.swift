import Foundation

/// 摔倒/剧烈撞击检测状态机（纯逻辑）。输入为加速度计采样的**总加速度模长**（单位 g，含重力，静止≈1g）。
///
/// 摔倒模式（人/手机坠落三段式）：
///   ①自由落体：|a| < 0.35g 持续 ≥0.25s（坠落中近失重）
///   ②撞击：落体结束后 1.2s 内出现 |a| > 2.8g 尖峰
///   ③静止：撞击后 2.5s 内基本不动（均值≈1g、波动小）→ 报 suspectedFall
///   （撞击后仍在剧烈活动 = 大概率自己爬起来了，保守不报，避免日常磕碰频繁误报）
///
/// 车祸模式：|a| > 6g 的极端冲击（远超日常跌落）直接进入静止判定，静止则报 suspectedCrash。
///
/// 注意：手机跌落与人摔倒在传感器上不可区分——上层文案统一为"疑似摔倒或剧烈撞击"，
/// 并必须有取消倒计时（用户确认环节），不可直接对外发警报。
public struct FallDetector: Sendable {
    public enum Event: Equatable, Sendable { case none, suspectedFall, suspectedCrash }

    // 阈值（公开常量便于上层显示/调参）
    public static let freefallG = 0.35
    public static let impactG = 2.8
    public static let crashG = 6.0
    public static let freefallMinDuration: TimeInterval = 0.25
    public static let impactWindow: TimeInterval = 1.2
    public static let stillnessDuration: TimeInterval = 2.5

    private enum State: Equatable {
        case idle
        case freefall(since: TimeInterval)
        case awaitingImpact(deadline: TimeInterval)
        case stillness(until: TimeInterval, crash: Bool)
    }

    private var state: State = .idle
    private var stillSamples: [Double] = []

    public init() {}

    /// 喂入一个采样；返回触发的事件（通常为 .none）。采样率建议 ≥10Hz。
    public mutating func ingest(magnitude: Double, at t: TimeInterval) -> Event {
        guard magnitude.isFinite, t.isFinite else { return .none } // 非有限输入不进状态机

        // 极端冲击（车祸级）在任意状态下都直接进入静止判定。
        if magnitude > Self.crashG {
            state = .stillness(until: t + Self.stillnessDuration, crash: true)
            stillSamples = []
            return .none
        }

        switch state {
        case .idle:
            if magnitude < Self.freefallG { state = .freefall(since: t) }
            return .none

        case .freefall(let since):
            if magnitude < Self.freefallG {
                if t - since >= Self.freefallMinDuration {
                    state = .awaitingImpact(deadline: t + Self.impactWindow)
                }
                return .none
            }
            // 落体足够长且立即出现撞击（同一采样跨越两段）。
            if t - since >= Self.freefallMinDuration, magnitude > Self.impactG {
                state = .stillness(until: t + Self.stillnessDuration, crash: false)
                stillSamples = []
                return .none
            }
            state = .idle // 失重太短：普通晃动
            return .none

        case .awaitingImpact(let deadline):
            if magnitude > Self.impactG {
                state = .stillness(until: t + Self.stillnessDuration, crash: false)
                stillSamples = []
            } else if t > deadline {
                state = .idle // 落体后没有撞击（被接住/轻放）
            }
            return .none

        case .stillness(let until, let crash):
            if t < until {
                stillSamples.append(magnitude)
                return .none
            }
            defer { state = .idle; stillSamples = [] }
            guard stillSamples.count >= 5 else { return .none } // 样本太少不可判
            let mean = stillSamples.reduce(0, +) / Double(stillSamples.count)
            let spread = (stillSamples.max() ?? 1) - (stillSamples.min() ?? 1)
            // 静止：贴近 1g 且波动小。撞击后仍在大幅活动 → 用户行动正常，不报。
            if mean > 0.8, mean < 1.2, spread < 0.5 {
                return crash ? .suspectedCrash : .suspectedFall
            }
            return .none
        }
    }

    public mutating func reset() {
        state = .idle
        stillSamples = []
    }
}
