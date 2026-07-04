import Foundation

/// 拍摄稳定度判据（纯逻辑，可单测）。盲人看不到取景画面的运动模糊——手抖时拍下的文档/标签/条码，
/// OCR 会糊掉、识别失败却不自知，只能反复重拍。本模块判断设备是否**持续稳定足够久**，供上层「稳了
/// 自动快门 / 提示现在可拍」——对标 Seeing AI 等的自动拍照，避免糊帧空耗。
///
/// 输入：设备运动的**旋转角速率模长**（rad/s，来自 CMDeviceMotion.rotationRate 三轴取模）。旋转最毁
/// 文字识别（角速度直接把笔画拉花，平移在阅读距离上影响小得多），故以旋转为准。
///
/// 判据（迟滞去抖）：角速率**持续** ≤ 阈值达 holdDuration 才判 .steady；期间任一帧超阈值即重新计时
/// （避免手抖间隙的瞬时低值被当成稳定而拍下糊帧）。坏样本（非有限/负模长）保守视为运动、重置计时。
public struct CaptureSteadiness: Sendable {
    /// 稳定状态：moving 正在动（提示握稳）；settling 已静下但时长不够（快了，继续保持）；steady 达标可拍。
    public enum State: Equatable, Sendable { case moving, settling, steady }

    public let rotationThreshold: Double  // rad/s：低于视为静。0.12≈轻微手持微颤之下、刻意移动之上。
    public let holdDuration: TimeInterval // 需持续静多久才判稳（防按下瞬间的抖动糊帧）。

    private var steadySince: TimeInterval?

    public init(rotationThreshold: Double = 0.12, holdDuration: TimeInterval = 0.35) {
        self.rotationThreshold = rotationThreshold
        self.holdDuration = holdDuration
    }

    /// 喂入一帧角速率模长与时间戳，返回当前稳定状态。上层可在 settling/moving→steady 的**上升沿**触发
    /// 一次自动快门，拍完调 reset() 重新计时。
    public mutating func ingest(rotationRate: Double, at t: TimeInterval) -> State {
        // 坏样本保守当运动：绝不在无效数据上判"稳"而拍下糊帧（与全库 isFinite 守卫一致）。
        guard rotationRate.isFinite, rotationRate >= 0, t.isFinite else {
            steadySince = nil
            return .moving
        }
        guard rotationRate <= rotationThreshold else {
            steadySince = nil          // 一旦超阈值即重新计时
            return .moving
        }
        let since = steadySince ?? t   // 首个静帧：立此刻为基线
        if steadySince == nil { steadySince = t }
        return (t - since) >= holdDuration ? .steady : .settling
    }

    /// 拍完 / 换目标时清零计时（下次须重新持稳 holdDuration 才再判 steady）。
    public mutating func reset() {
        steadySince = nil
    }
}
