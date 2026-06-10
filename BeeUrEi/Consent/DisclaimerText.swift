import Foundation

/// 免责声明全文（见 docs/PLAN.md §1.3 红线）。
/// ⚠️ 英文版为对照中文逐条翻译的**草稿**：属法律文本，上架前需法务/母语者校对（见 PROJECT_STATUS E5 余量）。
enum DisclaimerText {
    static let full = """
    BeeUrEi 是辅助工具，不是安全保障设备。

    • 它不能替代白手杖、导盲犬或定向行走（O&M）专业训练；请始终保留并优先使用它们。
    • 它不保证检测出所有障碍——尤其是低矮路桩、台阶边缘、地面坑洞、玻璃门、悬空的招牌或树枝、以及移动中的车辆。
    • 摄像头与 LiDAR 避障受光线、发热、设备性能影响，可能漏报或误报。
    • 请勿将本 App 作为出行的唯一依据。

    点击「我已理解并同意」表示你已知悉以上局限并自愿使用。
    """

    static let fullEnglishDraft = """
    BeeUrEi is an assistive tool, not a safety device.

    • It does not replace a white cane, a guide dog, or professional Orientation & Mobility (O&M) training; always keep and prioritize them.
    • It is not guaranteed to detect every obstacle — especially low bollards, step edges, potholes, glass doors, overhanging signs or branches, and moving vehicles.
    • Camera and LiDAR detection are affected by lighting, device heat and performance, and may miss or misreport obstacles.
    • Do not rely on this app as your only means of getting around.

    Tapping "I understand and agree" means you acknowledge these limits and choose to use the app.
    """

    /// 按语言取全文（英文为草稿，待校对）。
    static func full(_ l: Language) -> String {
        l == .zh ? full : fullEnglishDraft
    }
}
