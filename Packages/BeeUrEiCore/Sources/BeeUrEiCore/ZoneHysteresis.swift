import Foundation

/// 接近分区滞回（PERCEPTION §6 残留）：进/出阈值分离，
/// 防止用户站在阈值边界（如 1.0m 上下抖动）时 danger↔caution 反复横跳、播报来回触发。
/// 进 danger < enterDanger(1.0m)，出 danger 需 > exitDanger(1.4m)；caution 同理 2.5/2.9。
public struct ZoneHysteresis {
    private let enterDanger: Double
    private let exitDanger: Double
    private let enterCaution: Double
    private let exitCaution: Double
    private var current: ProximityZone = .clear

    public init(enterDanger: Double = 1.0, exitDanger: Double = 1.4,
                enterCaution: Double = 2.5, exitCaution: Double = 2.9) {
        self.enterDanger = enterDanger
        self.exitDanger = exitDanger
        self.enterCaution = enterCaution
        self.exitCaution = exitCaution
    }

    /// 喂入本帧最近距离（nil=无读数→维持当前区，不因数据缺口闪跳），返回滞回后的分区。
    public mutating func update(nearest: Double?) -> ProximityZone {
        guard let d = nearest, d.isFinite else { return current }
        switch current {
        case .danger:
            if d > exitCaution { current = .clear }
            else if d > exitDanger { current = .caution }
        case .caution:
            if d < enterDanger { current = .danger }
            else if d > exitCaution { current = .clear }
        case .clear:
            if d < enterDanger { current = .danger }
            else if d < enterCaution { current = .caution }
        }
        return current
    }

    public mutating func reset() { current = .clear }
}
