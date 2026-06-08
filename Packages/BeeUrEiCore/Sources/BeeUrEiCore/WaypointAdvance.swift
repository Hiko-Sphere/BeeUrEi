import Foundation

/// 转向点"已越过"判定（纯逻辑，可单测）。
///
/// 步行导航中，判断用户是否走过当前转向点以推进到下一步。早期实现把推进绑定到
/// "必须命中 5m 即将窗 + 高精度 + 已播现在指令"，过于脆弱：持续 .beacon 精度或采样稀疏/快走/贴边
/// 走过时，最近一帧距离 >5m，导致永不推进、信标长期指回已走过的转向点（stranding，让盲人往回走）。
///
/// 改用稳健的"越过波谷"几何判定，**不依赖定位精度等级与单帧精确命中**：
/// - 记录到当前转向点的历史最近距离 `minDist`；
/// - 当用户确已接近过该点（`minDist <= approachWithinMeters`）、且距离明显回升
///   （`distance > minDist + recedeMargin`，即走过了最近点），判定"正在远离"；
/// - 需连续 `confirmFrames` 帧都判定"正在远离"才确认已越过，抵抗低精度单帧 GPS 抖动造成的误推进。
///
/// 调用方应仅在定位精度可信（非 `.none`）时喂入距离；`.none` 噪声过大，几何判定不可靠。
public struct WaypointAdvance: Sendable {
    public let approachWithinMeters: Double
    public let recedeMarginMeters: Double
    public let confirmFrames: Int

    private var minDist: Double = .greatestFiniteMagnitude
    private var recedingStreak: Int = 0

    public init(approachWithinMeters: Double = 20, recedeMarginMeters: Double = 4, confirmFrames: Int = 2) {
        self.approachWithinMeters = approachWithinMeters
        self.recedeMarginMeters = max(0, recedeMarginMeters)
        self.confirmFrames = max(1, confirmFrames)
    }

    /// 喂入当前到转向点的距离（米，>=0）。返回 true 表示判定"已越过该转向点"，调用方应推进并随后 `reset()` 进入下一点。
    /// 返回 true 的同一次调用内部已自动复位，可连续用于多步推进。
    public mutating func update(distanceMeters: Double) -> Bool {
        guard distanceMeters.isFinite, distanceMeters >= 0 else { return false }
        if distanceMeters < minDist { minDist = distanceMeters }

        let approached = minDist <= approachWithinMeters
        let receding = distanceMeters > minDist + recedeMarginMeters
        if approached && receding {
            recedingStreak += 1
        } else {
            recedingStreak = 0
        }

        if recedingStreak >= confirmFrames {
            reset()
            return true
        }
        return false
    }

    /// 进入新转向点 / 重新规划 / 开始导航时调用，清空波谷基线与确认计数。
    public mutating func reset() {
        minDist = .greatestFiniteMagnitude
        recedingStreak = 0
    }
}
