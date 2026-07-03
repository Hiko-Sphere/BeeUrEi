import Foundation

/// 红绿灯状态时间稳定化（安全攸关）：逐帧判色会抖动，需**连续 N 帧一致**才改判，
/// 避免红/绿之间误闪导致危险提示（见 docs/PERCEPTION_ALGORITHM §5.7）。纯逻辑，可单测。
public final class TrafficLightStabilizer {
    public let confirmFrames: Int
    /// 离开「绿」所需的一致帧数（安全不对称）：过街错误代价极不对称——假绿(多播几帧"可通行"到已变红的
    /// 路口)=踩进车流(致命)，短暂误停=白等(小事)。故**确认绿仍需 confirmFrames，但离开绿更快**
    /// (默认 2<3)，缩短绿→红时"绿灯可通行"+快节奏的残留窗口，永远偏向"等待"；默认 2 仍抗单帧噪声。
    public let leaveGreenFrames: Int
    private var candidate: TrafficLightState = .unknown
    private var candidateCount = 0
    private(set) public var confirmed: TrafficLightState = .unknown

    public init(confirmFrames: Int = 3, leaveGreenFrames: Int = 2) {
        self.confirmFrames = max(1, confirmFrames)
        self.leaveGreenFrames = min(max(1, leaveGreenFrames), max(1, confirmFrames)) // ∈[1, confirmFrames]
    }

    /// 喂入本帧判色，返回稳定后的状态。
    @discardableResult
    public func update(_ state: TrafficLightState) -> TrafficLightState {
        if state == confirmed {
            candidate = state
            candidateCount = 0
            return confirmed
        }
        if state == candidate {
            candidateCount += 1
        } else {
            candidate = state
            candidateCount = 1
        }
        // 安全不对称：当前确认为「绿」而新候选非绿（灯要变了）→ 用更小的 leaveGreenFrames 尽快离开绿。
        // 宁可短暂误停(白等，安全)也绝不让"可通行"多播几帧到已变红的路口(致命)。其余转换按 confirmFrames。
        let threshold = (confirmed == .green && candidate != .green) ? leaveGreenFrames : confirmFrames
        if candidateCount >= threshold {
            confirmed = candidate
            candidateCount = 0
        }
        return confirmed
    }

    public func reset() {
        candidate = .unknown
        candidateCount = 0
        confirmed = .unknown
    }
}
