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

    /// 安全四舍五入为非负 Int：非有限退化为 0，并夹到安全范围——防 `Int(非有限/越界 Double)` 陷阱崩溃
    /// （异常视觉帧可产生 NaN/∞/巨值距离；`.isFinite` 挡不住量级。见 ClockDirection 同类修复）。
    /// public：App 层任何"来自传感器/路线 API/服务器的 Double 距离转 Int"都应经此——如后端返回巨值
    /// distanceMeters（>Int.max）直接 Int() 会溢出崩溃（见导航步距崩溃修复）。
    public static func safeRoundedInt(_ v: Double) -> Int {
        guard v.isFinite else { return 0 }
        return Int(min(max(v, 0), 1_000_000).rounded())
    }

    /// 详细距离：非法/退化距离退化为「非常近」。
    public static func meters(_ d: Double, _ lang: Language) -> String {
        guard d.isFinite, d > 0 else { return veryClose(lang) }
        let cm = safeRoundedInt(d * 100) // d 巨值时 d*100 仍会让 Int(...) 溢出崩溃，故用安全转换
        if cm <= 0 { return veryClose(lang) }
        switch lang {
        case .zh: return cm < 100 ? "\(cm) 厘米" : String(format: "%.1f 米", d)
        case .en: return cm < 100 ? "\(cm) cm" : String(format: "%.1f m", d)
        }
    }

    /// 简短距离：<0.5 很近、<1 半米、否则整米。
    public static func conciseMeters(_ d: Double, _ lang: Language) -> String {
        // 非有限（异常帧的 NaN/∞）保守退化为「很近」——否则 d<0.5 等比较对 NaN 皆假，落到 Int(NaN) 陷阱崩溃。
        guard d.isFinite else { return veryClose(lang) }
        switch lang {
        case .zh:
            if d < 0.5 { return "很近" }
            if d < 1 { return "半米" }
            return "\(safeRoundedInt(d))米"
        case .en:
            if d < 0.5 { return "very close" }
            if d < 1 { return "half a meter" }
            return "\(safeRoundedInt(d))m"
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
        // 非有限（异常帧）保守退化为最近档「半米」——防 Int(NaN)/Int(巨值) 在地面高危播报路径上崩溃。
        guard d.isFinite else { return lang == .zh ? "半米" : "half a meter" }
        switch lang {
        case .zh: return d < 0.5 ? "半米" : "\(safeRoundedInt(d))米"
        case .en: return d < 0.5 ? "half a meter" : "\(safeRoundedInt(d))m"
        }
    }

    // MARK: 头/胸高悬空障碍（OverheadHazardDetector）——盲杖探不到，措辞明确护头/上身。

    public static func overheadHead(metersStr: String, _ lang: Language) -> String {
        switch lang {
        case .zh: return "当心头部，前方约\(metersStr)有高处障碍"
        case .en: return "Careful, head-height obstacle about \(metersStr) ahead"
        }
    }

    public static func overheadTorso(metersStr: String, _ lang: Language) -> String {
        switch lang {
        case .zh: return "当心，前方约\(metersStr)有齐胸障碍"
        case .en: return "Careful, chest-height obstacle about \(metersStr) ahead"
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

    // MARK: 光线（LightMeter）

    public static func lightLevel(_ level: LightMeter.Level, _ lang: Language) -> String {
        switch lang {
        case .zh:
            switch level {
            case .dark: return "光线很暗"
            case .dim: return "光线较暗"
            case .ok: return "光线充足"
            }
        case .en:
            switch level {
            case .dark: return "It's dark"
            case .dim: return "Light is dim"
            case .ok: return "Light is good"
            }
        }
    }

    public static func lightBrighter(left: Bool, _ lang: Language) -> String {
        switch lang {
        case .zh: return left ? "，亮的方向在左边" : "，亮的方向在右边"
        case .en: return left ? ", brighter to the left" : ", brighter to the right"
        }
    }

    public static func lightWarning(_ level: LightMeter.Level, _ lang: Language) -> String? {
        switch lang {
        case .zh:
            switch level {
            case .dark: return "光线太暗，可能看不清，请到亮一点的地方再试"
            case .dim: return "光线较暗，识别可能不准"
            case .ok: return nil
            }
        case .en:
            switch level {
            case .dark: return "Too dark to see well — try again in a brighter place"
            case .dim: return "Low light, recognition may be less accurate"
            case .ok: return nil
            }
        }
    }

    // MARK: 人物（PeopleSummarizer）

    public static func peopleNone(_ lang: Language) -> String {
        switch lang {
        case .zh: return "没有看到人"
        case .en: return "No people in view"
        }
    }

    public static func peopleOne(direction: String, distance: String?, _ lang: Language) -> String {
        switch lang {
        case .zh: return "看到 1 个人：\(direction)" + (distance.map { "，大约\($0)" } ?? "")
        case .en: return "1 person: \(direction)" + (distance.map { ", about \($0)" } ?? "")
        }
    }

    public static func peopleMany(count: Int, nearestDirection: String, nearestDistance: String?,
                                  others: [String], _ lang: Language) -> String {
        // **有距离才敢称"最近的"**：无 LiDAR/读数缺失时排序退化为横向序（非真实远近），此时称某人"最近"是
        // 没有依据的假精度——只报方位、不谎称谁最近（同 WeatherPhrase/LightMeter 的"坏/缺数据不硬报"取向）。
        switch lang {
        case .zh:
            let lead = nearestDistance.map { "最近的在\(nearestDirection)，大约\($0)" } ?? "有人在\(nearestDirection)"
            var s = "看到 \(count) 个人。" + lead
            if !others.isEmpty { s += "；其他在" + others.joined(separator: "、") }
            return s
        case .en:
            let lead = nearestDistance.map { "Nearest \(nearestDirection), about \($0)" } ?? "One \(nearestDirection)"
            var s = "\(count) people. " + lead
            if !others.isEmpty { s += "; others " + others.joined(separator: ", ") }
            return s
        }
    }

    // MARK: 颜色（ColorNamer）

    public enum ColorKey { case black, white, gray, brown, beige, red, orange, yellow, green, cyan, blue, purple, pink, unknown }

    public static func color(_ key: ColorKey, _ lang: Language) -> String {
        switch lang {
        case .zh:
            switch key {
            case .black: return "黑色"; case .white: return "白色"; case .gray: return "灰色"
            case .brown: return "棕色"; case .beige: return "米色"; case .red: return "红色"; case .orange: return "橙色"
            case .yellow: return "黄色"; case .green: return "绿色"; case .cyan: return "青色"
            case .blue: return "蓝色"; case .purple: return "紫色"; case .pink: return "粉色"
            case .unknown: return "未知颜色"
            }
        case .en:
            switch key {
            case .black: return "black"; case .white: return "white"; case .gray: return "gray"
            case .brown: return "brown"; case .beige: return "beige"; case .red: return "red"; case .orange: return "orange"
            case .yellow: return "yellow"; case .green: return "green"; case .cyan: return "cyan"
            case .blue: return "blue"; case .purple: return "purple"; case .pink: return "pink"
            case .unknown: return "unknown color"
            }
        }
    }

    /// 配色和谐度播报（配 ColorNamer.harmony）：措辞保守，不做主观时尚裁断。
    public static func colorHarmony(_ h: ColorNamer.ColorHarmony, _ lang: Language) -> String {
        switch (h, lang) {
        case (.neutral, .zh):  return "有中性色，比较百搭"
        case (.neutral, .en):  return "one is a neutral tone, so it goes with most things"
        case (.similar, .zh):  return "同色系，比较协调"
        case (.similar, .en):  return "similar tones, they coordinate well"
        case (.contrast, .zh): return "对比色，撞色搭配，比较醒目"
        case (.contrast, .en): return "contrasting colors, a bold and eye-catching pairing"
        case (.caution, .zh):  return "两个颜色差异较大，拿不准的话可以问一下别人"
        case (.caution, .en):  return "quite different colors; if you're unsure, you might ask someone"
        }
    }

    /// 颜色深浅前缀（配 ColorNamer.describe）：中文"深"/"浅"直接拼色名（深蓝色）；英文带尾空格拼（dark blue）。
    public static func tonePrefix(dark: Bool, _ lang: Language) -> String {
        switch lang {
        case .zh: return dark ? "深" : "浅"
        case .en: return dark ? "dark " : "light "
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

    /// 新绿起步（CrossingSignalGate）：亲见红/黄→绿跳变且在稳定步行窗内，整段相位在前方，可起步。
    public static func crossFreshGreen(_ lang: Language) -> String {
        switch lang {
        case .zh: return "绿灯刚亮，可以起步过街，保持直行、注意车辆"
        case .en: return "Walk signal just started, you can begin crossing, keep straight and watch for cars"
        }
    }

    /// 陈旧绿/新绿超窗：灯虽绿但可能快结束，起步走不完——等下一个绿灯再过更安全。
    public static func crossWaitNextGreen(_ lang: Language) -> String {
        switch lang {
        case .zh: return "已是绿灯但可能快结束，请等下一个绿灯再过街"
        case .en: return "The light is green but may end soon, wait for the next green to cross"
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
    /// 外部中断（来电等）结束、避障会话自动恢复后播报——与"测距暂停"对称，消除"还在工作吗"的疑虑。
    public static func rangingResumed(_ lang: Language) -> String {
        switch lang { case .zh: return "测距已恢复"; case .en: return "Ranging resumed" }
    }
    public static func avoidanceOff(_ lang: Language) -> String {
        switch lang { case .zh: return "避障已关闭"; case .en: return "Obstacle alerts off" }
    }
    /// 跟踪质量降级提示（TrackingGate；中文与历史逐字一致）。
    public static func trackingUnstable(_ lang: Language) -> String {
        switch lang { case .zh: return "跟踪不稳，请放慢移动"; case .en: return "Tracking unstable — please move slower" }
    }
    public static func trackingLowFeatures(_ lang: Language) -> String {
        switch lang { case .zh: return "环境特征不足，测距精度下降"; case .en: return "Not enough visual features — distance accuracy reduced" }
    }
    public static func trackingInitializing(_ lang: Language) -> String {
        switch lang { case .zh: return "正在初始化跟踪，请稍候"; case .en: return "Starting up tracking, one moment" }
    }
    public static func trackingLimited(_ lang: Language) -> String {
        switch lang { case .zh: return "跟踪受限，测距精度下降"; case .en: return "Tracking limited — distance accuracy reduced" }
    }
    public static func trackingUnavailable(_ lang: Language) -> String {
        switch lang { case .zh: return "无法测距，避障已降级"; case .en: return "Can't measure distance — obstacle alerts degraded" }
    }

    /// 热降级提示（serious：降频仍在保护）。
    public static func thermalSlowdown(_ lang: Language) -> String {
        switch lang { case .zh: return "设备发热，已降低处理频率"; case .en: return "Device is warm — processing rate reduced" }
    }

    /// 热停机提示（critical：避障暂停 + 志愿者兜底指引）。
    public static func thermalPausedVolunteer(_ lang: Language) -> String {
        switch lang { case .zh: return "设备过热，避障暂停，可呼叫志愿者协助"; case .en: return "Device overheated — obstacle alerts paused. You can call a volunteer for help" }
    }

    /// 电量极低降级提示。
    public static func powerCriticalLow(_ lang: Language) -> String {
        switch lang { case .zh: return "电量极低，已降到最低处理频率，请尽快充电"; case .en: return "Battery critically low — running at minimum rate, please charge soon" }
    }

    /// 省电模式/低电量降级提示。
    public static func powerSaverSlowdown(_ lang: Language) -> String {
        switch lang { case .zh: return "省电模式 / 低电量，已降低处理频率"; case .en: return "Low Power Mode or low battery — processing rate reduced" }
    }

    /// 无盲道数据段的路线降级提示。
    public static func noTactilePavingFallback(_ lang: Language) -> String {
        switch lang { case .zh: return "本段无盲道数据，已切换为普通步行 + 实时避障"; case .en: return "No tactile-paving data for this segment — switched to regular walking with live obstacle alerts" }
    }

    public static func deviceOverheated(_ lang: Language) -> String {
        switch lang { case .zh: return "设备过热，避障暂停"; case .en: return "Device overheated, obstacle alerts paused" }
    }
}
