import Foundation

/// 开发者模式开关（本地持久化，**手动开启**，无需账号；见 PLAN §14.4）。
/// 开启后首屏叠加显示温度/帧率/检测器等调试信息。
struct DevSettings {
    private let defaults: UserDefaults
    private let key = "dev.modeEnabled"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var enabled: Bool {
        get { defaults.bool(forKey: key) }
        set { defaults.set(newValue, forKey: key) }
    }

    /// 实验：用碰撞走廊算动态 ROI 喂检测器（默认关；需真机配合相机/平面调参）。
    private let dynamicROIKey = "dev.dynamicROIEnabled"
    var dynamicROIEnabled: Bool {
        get { defaults.bool(forKey: dynamicROIKey) }
        set { defaults.set(newValue, forKey: dynamicROIKey) }
    }
}
