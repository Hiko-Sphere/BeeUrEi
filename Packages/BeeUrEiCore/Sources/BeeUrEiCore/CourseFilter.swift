import Foundation

/// GPS 航迹方向（course over ground，"正在朝哪个方向移动"）的可信过滤（纯逻辑，可单测）。
///
/// 与罗盘航向（[[HeadingFilter]]，磁力计"我面朝哪"）**不同**：course 来自 GPS 位移方向，仅移动时有效——
/// 低速/静止时 `CLLocation.course` 为 -1（无效），或虽 ≥0 但 `courseAccuracy` 很大（±几十度，几乎无参考价值）。
/// 共享给亲友的"正朝X方向移动"（SharingContactRow/headingPhrase）若用不可信 course，八方位每档 45°、
/// 大误差会**整档报错**，误导监护的家人——与「我朝哪个方向」对罗盘的门槛同一原则：**valid ≠ trustworthy**。
public enum CourseFilter {
    /// 航迹方向可信阈值（度）：`courseAccuracy` 超过此值即视为太不确定、连"粗略八方位"都名不副实。
    /// 取一档（45°）偏宽的 60°——**从宽保留**稳定行走时的有效方向（步行 course 精度常 ±30~45°），仅剔除
    /// 明显是噪声/近静止的读数；过紧会让"移动方向"几乎不显示（可用性倒退），过松则乱指。
    public static let defaultMaxAccuracyDegrees: Double = 60

    /// 供上报/展示的可信航迹方向：course 有效(有限 ∧ ≥0) ∧ 精度可信（`accuracyDegrees` 有效 ∧ ≤上限）
    /// 才返回**归一到 [0,360)** 的度数，否则 nil（不上报＝对端省略"移动方向"，好过报一个乱指的方向）。
    /// - `accuracyDegrees` 传 nil＝设备/来源不带精度信息：退化为仅按 `course ≥ 0` 判定（不改旧行为、不误伤）。
    /// - `courseAccuracy < 0` 表示无效（iOS 13.4+ 语义）——连同"有效但过大"一并剔除。
    public static func trustworthyCourse(courseDegrees: Double,
                                         accuracyDegrees: Double?,
                                         maxAccuracyDegrees: Double = CourseFilter.defaultMaxAccuracyDegrees) -> Double? {
        guard courseDegrees.isFinite, courseDegrees >= 0 else { return nil }
        if let acc = accuracyDegrees {
            guard acc.isFinite, acc >= 0, acc <= maxAccuracyDegrees else { return nil }
        }
        let n = courseDegrees.truncatingRemainder(dividingBy: 360)
        return n < 0 ? n + 360 : n
    }
}
