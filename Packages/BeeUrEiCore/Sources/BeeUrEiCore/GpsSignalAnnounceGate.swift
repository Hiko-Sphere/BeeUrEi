import Foundation

/// 定位信号可用度播报去抖（纯逻辑，可单测）。
/// 盲人看不到屏幕上的定位精度——GPS 信号弱（高楼峡谷 / 隧道 / 室内，`horizontalAccuracy` 超阈值或无效）时，
/// 方向音信标、偏航检测、剩余里程播报会**静默停掉**：盲人既不知为何突然安静，也分不清是「到了」「卡死」还是「信号弱」，
/// 可能误以为只是暂时没提示而继续盲走、冲进车道。故须**语音**告知：信号持续不可用时提示留在原地稍候，
/// 恢复可用时告知继续引导——与 `CompassAnnounceGate`（罗盘静默停信标时的告知）同一安全逻辑。
/// 只播**持续** ≥ sustainSeconds 的状态变化——避免精度在阈值附近抖动（如短暂走过遮蔽物）时"弱/恢复"来回刷屏。
/// 初始假定可用（announcedUsable=true）：故若导航开始后一直拿不到可用定位、持续够久也会提示一次。
public struct GpsSignalAnnounceGate: Sendable {
    public enum Cue: Equatable, Sendable {
        case none       // 无需播报
        case weak       // 持续不可用：提示信号弱、方向提示已暂停、留在原地稍候
        case restored   // 持续恢复可用：告知定位恢复、继续引导
    }

    public let sustainSeconds: TimeInterval
    private var announcedUsable = true       // 上次**已播**的稳定态
    private var pendingUsable: Bool? = nil    // 与已播态不同、正计时确认的候选态
    private var pendingSince: TimeInterval = 0

    public init(sustainSeconds: TimeInterval = 4) { self.sustainSeconds = max(0, sustainSeconds) }

    /// 每次拿到定位精度门控结果时调用（usable = 精度门控 level != .none，即能否安全下达方向指令）。
    /// 返回此刻应播的提示。t 为单调时钟秒（用 `ProcessInfo.systemUptime`，避免系统时间回拨冻结去抖）。
    public mutating func update(usable: Bool, at t: TimeInterval) -> Cue {
        if usable == announcedUsable {
            pendingUsable = nil   // 与已播态一致：取消任何候选计时
            return .none
        }
        // 与已播态不同：开始或延续候选态计时（同候选不重置 pendingSince）。
        if pendingUsable != usable {
            pendingUsable = usable
            pendingSince = t
        }
        guard t - pendingSince >= sustainSeconds else { return .none } // 未持续够久：先不播（去抖）
        announcedUsable = usable
        pendingUsable = nil
        return usable ? .restored : .weak
    }
}
