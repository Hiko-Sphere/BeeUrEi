import Foundation

/// 红绿灯状态时间稳定化（安全攸关）：逐帧判色会抖动，需**连续 N 帧一致**才改判，
/// 避免红/绿之间误闪导致危险提示（见 docs/PERCEPTION_ALGORITHM §5.7）。纯逻辑，可单测。
public final class TrafficLightStabilizer {
    public let confirmFrames: Int
    private var candidate: TrafficLightState = .unknown
    private var candidateCount = 0
    private(set) public var confirmed: TrafficLightState = .unknown

    public init(confirmFrames: Int = 3) {
        self.confirmFrames = max(1, confirmFrames)
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
        if candidateCount >= confirmFrames {
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
