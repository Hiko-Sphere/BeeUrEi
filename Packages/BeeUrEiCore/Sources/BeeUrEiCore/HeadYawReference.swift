import Foundation

/// AirPods 头部偏航参考系（见 docs/PLAN.md §14 Q8 / 参考 Microsoft Soundscape 头追踪）。
///
/// `CMHeadphoneMotionManager` 报告的 `attitude.yaw` 是**相对「会话启动那一刻的任意参考朝向」**的角度，
/// 并会随时间缓慢漂移。若直接把它当作空间音「听者朝向」，会出现两个问题：
/// 1. **开机偏置**：戴上耳机那一刻头朝哪，信标整体就被偏转那个随机角度——用户没转头，信标却歪了。
/// 2. **断连重连跳变**：耳机取下再戴回，参考朝向重置，听者朝向会突然跳一大角。
///
/// 本类型把**首个有效样本锁为「零位」**（约定为用户面朝行进方向、头与身体对齐的一刻），
/// 之后只输出**相对零位**的偏航。这样「头朝正前 → 相对偏航≈0 → 信标落在身体相对方位」成立；
/// 用户转头时信标保持世界固定（Soundscape 式头追踪体验）。耳机断连时 `reset()`，重连自动重新标定。
///
/// 纯数学、平台无关（仅 Foundation），可用 `swift test` 直接覆盖。
public struct HeadYawReference: Sendable, Equatable {
    private var referenceDegrees: Double?

    public init() {}

    /// 是否已锁定零位。
    public var isCalibrated: Bool { referenceDegrees != nil }

    /// 清除零位。耳机断连/重连、或导航重启时调用，使下一个有效样本重新标定为零位。
    public mutating func reset() { referenceDegrees = nil }

    /// 显式把某个原始偏航设为零位（支持「现在朝前，请重新校准」交互）。非有限输入忽略。
    public mutating func recenter(toRawDegrees raw: Double) {
        guard raw.isFinite else { return }
        referenceDegrees = HeadYawReference.wrap(raw)
    }

    /// 输入原始头部偏航（度），输出**相对零位**的偏航，规范化到 (-180, 180]。
    /// - 首个有限样本：自动锁为零位并返回 0。
    /// - 非有限输入（NaN/Inf，传感器抖动）：返回 0 且**不**更新零位，避免把坏值锁成基线。
    public mutating func relativeYaw(fromRawDegrees raw: Double) -> Double {
        guard raw.isFinite else { return 0 }
        let w = HeadYawReference.wrap(raw)
        guard let ref = referenceDegrees else {
            referenceDegrees = w
            return 0
        }
        return HeadYawReference.wrap(w - ref)
    }

    /// 规范化角度到 (-180, 180]：-180 归为 180，便于跨 ±180 边界做差值不跳变。
    static func wrap(_ degrees: Double) -> Double {
        var a = degrees.truncatingRemainder(dividingBy: 360)
        if a > 180 { a -= 360 }
        if a <= -180 { a += 360 }
        return a
    }
}
