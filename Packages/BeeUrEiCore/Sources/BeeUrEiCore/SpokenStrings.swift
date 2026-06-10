import Foundation

/// 播报文案中心表（i18n 单一真相来源）。所有「盲人听到的实时引导」叶子短语集中在此，按语言分支。
/// 加一门语言 = 在这里补一组 `case`，各 Composer 无需改动。中文输出与历史完全一致（保证既有测试不变）。
public enum SpokenStrings {

    // MARK: 方向（ClockDirection）

    public static func clockDirection(hour: Int, _ lang: Language) -> String {
        switch lang {
        case .zh: return "\(hour) 点钟方向"
        case .en: return "\(hour) o'clock"
        }
    }

    public static func coarseDirection(hour: Int, _ lang: Language) -> String {
        switch lang {
        case .zh:
            switch hour {
            case 12: return "正前方"
            case 1, 2: return "右前方"
            case 10, 11: return "左前方"
            case 3, 4, 5: return "右侧"
            case 7, 8, 9: return "左侧"
            default: return "后方"
            }
        case .en:
            switch hour {
            case 12: return "ahead"
            case 1, 2: return "ahead right"
            case 10, 11: return "ahead left"
            case 3, 4, 5: return "right"
            case 7, 8, 9: return "left"
            default: return "behind"
            }
        }
    }

    // MARK: 距离（SpeechComposer）

    /// 详细距离：非法/退化距离退化为「非常近」。
    public static func meters(_ d: Double, _ lang: Language) -> String {
        guard d.isFinite, d > 0 else { return veryClose(lang) }
        let cm = Int((d * 100).rounded())
        if cm <= 0 { return veryClose(lang) }
        switch lang {
        case .zh: return cm < 100 ? "\(cm) 厘米" : String(format: "%.1f 米", d)
        case .en: return cm < 100 ? "\(cm) cm" : String(format: "%.1f m", d)
        }
    }

    /// 简短距离：<0.5 很近、<1 半米、否则整米。
    public static func conciseMeters(_ d: Double, _ lang: Language) -> String {
        switch lang {
        case .zh:
            if d < 0.5 { return "很近" }
            if d < 1 { return "半米" }
            return "\(Int(d.rounded()))米"
        case .en:
            if d < 0.5 { return "very close" }
            if d < 1 { return "half a meter" }
            return "\(Int(d.rounded()))m"
        }
    }

    static func veryClose(_ lang: Language) -> String {
        switch lang {
        case .zh: return "非常近"
        case .en: return "very close"
        }
    }

    /// 「约 X」前缀（详细障碍播报用）。
    public static func approx(_ metersStr: String, _ lang: Language) -> String {
        switch lang {
        case .zh: return "约 \(metersStr)"
        case .en: return "about \(metersStr)"
        }
    }

    /// 障碍详细播报分隔（中文逗号 / 英文逗号空格）。
    public static func obstacleSeparator(_ lang: Language) -> String {
        switch lang {
        case .zh: return "，"
        case .en: return ", "
        }
    }

    // MARK: 近距预警（SpeechComposer.announceProximity）

    public static func proximityCaution(metersStr: String?, _ lang: Language) -> String {
        switch lang {
        case .zh: return metersStr.map { "前方约 \($0) 有障碍" } ?? "前方有障碍"
        case .en: return metersStr.map { "Obstacle about \($0) ahead" } ?? "Obstacle ahead"
        }
    }

    public static func proximityDanger(_ lang: Language) -> String {
        switch lang {
        case .zh: return "正前方很近，请停下"
        case .en: return "Very close ahead, please stop"
        }
    }

    // MARK: 地面高危（GroundHazardDetector）

    public static func groundDropOff(metersStr: String, _ lang: Language) -> String {
        switch lang {
        case .zh: return "注意，前方约\(metersStr)有落差或下台阶"
        case .en: return "Caution, drop-off or step down about \(metersStr) ahead"
        }
    }

    public static func groundStepUp(metersStr: String, _ lang: Language) -> String {
        switch lang {
        case .zh: return "注意，前方约\(metersStr)有台阶"
        case .en: return "Caution, step up about \(metersStr) ahead"
        }
    }

    /// 地面高危用的简短距离（半米 / 整米，无「厘米」档）。
    public static func groundMeters(_ d: Double, _ lang: Language) -> String {
        switch lang {
        case .zh: return d < 0.5 ? "半米" : "\(Int(d.rounded()))米"
        case .en: return d < 0.5 ? "half a meter" : "\(Int(d.rounded()))m"
        }
    }

    // MARK: 场景概述（SceneSummarizer）

    public static func sceneEmpty(_ lang: Language) -> String {
        switch lang {
        case .zh: return "前方没有识别到明显物体"
        case .en: return "No notable objects detected ahead"
        }
    }

    /// 分区名：0=左 1=中 2=右。
    public static func sceneZone(_ index: Int, _ lang: Language) -> String {
        switch lang {
        case .zh: return ["左边", "中间", "右边"][index]
        case .en: return ["on the left", "in the center", "on the right"][index]
        }
    }

    /// 物体计数项：>1 带数量。英文带复数后缀（label 为英文时）。
    public static func sceneCount(_ count: Int, label: String, _ lang: Language) -> String {
        guard count > 1 else { return label }
        switch lang {
        case .zh: return "\(count)个\(label)"
        case .en: return "\(count) \(label)s"
        }
    }

    /// 某分区汇总：「<区>有<内容>」。
    public static func sceneZoneHas(zone: String, desc: String, _ lang: Language) -> String {
        switch lang {
        case .zh: return "\(zone)有\(desc)"
        case .en: return "\(desc) \(zone)"
        }
    }

    public static func scenePrefix(_ lang: Language) -> String {
        switch lang {
        case .zh: return "前方："
        case .en: return "Ahead: "
        }
    }

    /// 同一区内物体之间的分隔。
    public static func sceneItemSeparator(_ lang: Language) -> String {
        switch lang {
        case .zh: return "、"
        case .en: return ", "
        }
    }

    /// 各分区之间的分隔。
    public static func scenePartSeparator(_ lang: Language) -> String {
        switch lang {
        case .zh: return "，"
        case .en: return "; "
        }
    }

    // MARK: 转向（RouteProgress）

    public static func maneuverNow(_ instruction: String, _ lang: Language) -> String {
        switch lang {
        case .zh: return "现在\(instruction)"
        case .en: return "Now \(instruction)"
        }
    }

    public static func maneuverSoon(_ instruction: String, _ lang: Language) -> String {
        switch lang {
        case .zh: return "前方即将\(instruction)"
        case .en: return "Soon: \(instruction)"
        }
    }

    public static func maneuverInMeters(_ meters: Int, instruction: String, _ lang: Language) -> String {
        switch lang {
        case .zh: return "前方约 \(meters) 米后\(instruction)"
        case .en: return "In about \(meters) m, \(instruction)"
        }
    }

    // MARK: 颜色（ColorNamer）

    public enum ColorKey { case black, white, gray, brown, red, orange, yellow, green, cyan, blue, purple, pink, unknown }

    public static func color(_ key: ColorKey, _ lang: Language) -> String {
        switch lang {
        case .zh:
            switch key {
            case .black: return "黑色"; case .white: return "白色"; case .gray: return "灰色"
            case .brown: return "棕色"; case .red: return "红色"; case .orange: return "橙色"
            case .yellow: return "黄色"; case .green: return "绿色"; case .cyan: return "青色"
            case .blue: return "蓝色"; case .purple: return "紫色"; case .pink: return "粉色"
            case .unknown: return "未知颜色"
            }
        case .en:
            switch key {
            case .black: return "black"; case .white: return "white"; case .gray: return "gray"
            case .brown: return "brown"; case .red: return "red"; case .orange: return "orange"
            case .yellow: return "yellow"; case .green: return "green"; case .cyan: return "cyan"
            case .blue: return "blue"; case .purple: return "purple"; case .pink: return "pink"
            case .unknown: return "unknown color"
            }
        }
    }

    // MARK: 过街（CrossingAssistant / TrafficLightClassifier）

    public static func crossingHasLight(_ lang: Language) -> String {
        switch lang {
        case .zh: return "前方有红绿灯，请确认信号后再过街"
        case .en: return "Traffic light ahead, confirm the signal before crossing"
        }
    }

    public static func trafficGreen(_ lang: Language) -> String {
        switch lang {
        case .zh: return "前方绿灯，可通行，仍请谨慎观察"
        case .en: return "Green light ahead, you may cross, stay cautious"
        }
    }

    public static func trafficRed(_ lang: Language) -> String {
        switch lang {
        case .zh: return "前方红灯，请等待"
        case .en: return "Red light ahead, please wait"
        }
    }

    public static func trafficYellow(_ lang: Language) -> String {
        switch lang {
        case .zh: return "前方黄灯，请勿通行"
        case .en: return "Yellow light ahead, do not cross"
        }
    }

    // MARK: 取景引导（FramingGuide）

    public static func framingSearching(_ lang: Language) -> String {
        switch lang {
        case .zh: return "正在寻找目标，请慢慢移动手机"
        case .en: return "Looking for the target, move the phone slowly"
        }
    }
    public static func framingMoveLeft(_ lang: Language) -> String {
        switch lang { case .zh: return "向左移动"; case .en: return "Move left" }
    }
    public static func framingMoveRight(_ lang: Language) -> String {
        switch lang { case .zh: return "向右移动"; case .en: return "Move right" }
    }
    public static func framingMoveUp(_ lang: Language) -> String {
        switch lang { case .zh: return "向上移动"; case .en: return "Move up" }
    }
    public static func framingMoveDown(_ lang: Language) -> String {
        switch lang { case .zh: return "向下移动"; case .en: return "Move down" }
    }
    public static func framingMoveCloser(_ lang: Language) -> String {
        switch lang { case .zh: return "靠近一点"; case .en: return "Move closer" }
    }
    public static func framingCentered(_ lang: Language) -> String {
        switch lang { case .zh: return "对准了，保持不动"; case .en: return "Centered, hold still" }
    }

    // MARK: 免责（DisclaimerPolicy）

    public static func disclaimerBrief(_ lang: Language) -> String {
        switch lang {
        case .zh: return "避障已开启，仅作辅助，请配合盲杖"
        case .en: return "Obstacle alerts on. This is an aid only — keep using your cane"
        }
    }

    // MARK: 避障状态/警告（HomeViewModel 状态栏与播报）

    /// 光线过暗警告（语音）。
    public static func lightLowWarning(_ lang: Language) -> String {
        switch lang {
        case .zh: return "光线较暗，物体识别能力下降，仅保留距离警告，请小心慢行"
        case .en: return "Low light: object recognition reduced, only distance alerts remain, please slow down"
        }
    }

    /// 正前方极近带米数（状态显示）。
    public static func proximityDangerMeters(_ d: Double, _ lang: Language) -> String {
        switch lang {
        case .zh: return String(format: "正前方约 %.1f 米，请注意", d)
        case .en: return String(format: "About %.1f m straight ahead, take care", d)
        }
    }

    public static func rangingPaused(_ lang: Language) -> String {
        switch lang { case .zh: return "测距暂停"; case .en: return "Ranging paused" }
    }
    public static func avoidanceOff(_ lang: Language) -> String {
        switch lang { case .zh: return "避障已关闭"; case .en: return "Obstacle alerts off" }
    }
    public static func deviceOverheated(_ lang: Language) -> String {
        switch lang { case .zh: return "设备过热，避障暂停"; case .en: return "Device overheated, obstacle alerts paused" }
    }
}
