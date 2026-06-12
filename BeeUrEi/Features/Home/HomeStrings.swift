import Foundation

/// 主屏（避障）文案中心表——E5 多语言主线第四批（与 FramingStrings/NavStrings 同模式）。
/// 覆盖磁贴/状态条/红绿灯横幅/权限与不支持页的用户可见文案。中文输出与历史完全一致。
/// 开发者叠层（DevOverlay）为内部工具，不在本地化范围。
enum HomeStrings {

    // MARK: 磁贴

    static func helpTitle(_ l: Language) -> String { l == .zh ? "求助" : "Get Help" }
    static func helpSubtitle(_ l: Language) -> String {
        l == .zh ? "呼叫志愿者或亲友帮你看" : "Call a volunteer or family member to see for you"
    }
    static func tileNav(_ l: Language) -> String { l == .zh ? "步行导航" : "Walk Navigate" }
    static func tileLook(_ l: Language) -> String { l == .zh ? "看一看" : "Look Around" }
    static func hintLook(_ l: Language) -> String {
        l == .zh ? "用相机对准物体，语音说出它是什么" : "Point the camera at something and hear what it is"
    }
    static func tileWhereAmI(_ l: Language) -> String { l == .zh ? "我在哪" : "Where Am I" }
    static func hintWhereAmI(_ l: Language) -> String {
        l == .zh ? "播报你当前位置和附近的地点" : "Announce your current location and nearby places"
    }
    static func tileAround(_ l: Language) -> String { l == .zh ? "周围有什么" : "What's Around" }
    static func hintAround(_ l: Language) -> String {
        l == .zh ? "按时钟方位播报四周的地点，如三点钟方向五十米便利店"
                 : "Announce places around you by clock direction, like a store at 3 o'clock, 50 meters"
    }
    static func tileAhead(_ l: Language) -> String { l == .zh ? "前方有什么" : "What's Ahead" }
    static func hintAhead(_ l: Language) -> String {
        l == .zh ? "只播报你面朝方向的地点" : "Announce only the places in the direction you're facing"
    }
    static func tileSettings(_ l: Language) -> String { l == .zh ? "设置" : "Settings" }
    static func tileWeather(_ l: Language) -> String { l == .zh ? "天气" : "Weather" }
    static func hintWeather(_ l: Language) -> String {
        l == .zh ? "播报当地天气与出行建议，如下雨提醒带伞" : "Announce local weather and travel tips, like bringing an umbrella"
    }
    static func envGroup(_ l: Language) -> String { l == .zh ? "环境感知" : "Surroundings" }
    static func magicTapHint(_ l: Language) -> String {
        l == .zh ? "双指双击可一键求助" : "Two-finger double-tap to call for help"
    }

    // MARK: 红绿灯横幅（Oko 式第三通道）

    static func trafficRed(_ l: Language) -> String { l == .zh ? "红灯 · 请等待" : "Red light · Wait" }
    static func trafficGreen(_ l: Language) -> String { l == .zh ? "绿灯 · 可通行" : "Green light · You may cross" }
    static func trafficYellow(_ l: Language) -> String { l == .zh ? "黄灯 · 请勿通行" : "Yellow light · Do not cross" }

    // MARK: 状态条 / 相机状态

    static func proximityBlocked(_ l: Language) -> String { l == .zh ? "正前方有障碍" : "Obstacle straight ahead" }
    static func proximityMeters(_ m: Double, _ l: Language) -> String {
        l == .zh ? String(format: "正前方约 %.1f 米", m) : String(format: "About %.1f m straight ahead", m)
    }
    static func proximityClear(_ l: Language) -> String { l == .zh ? "正前方通畅" : "Path ahead is clear" }
    static func clearAheadSpeech(_ l: Language) -> String { l == .zh ? "前方通畅" : "Path clear" }
    static func tapToRepeat(_ l: Language) -> String { l == .zh ? "点按重复播报" : "Tap to repeat the announcement" }
    static func cameraError(_ message: String, _ l: Language) -> String {
        l == .zh ? "相机出错：\(message)" : "Camera error: \(message)"
    }
    static func starting(_ l: Language) -> String { l == .zh ? "正在启动…" : "Starting…" }
    static func callHelper(_ l: Language) -> String { l == .zh ? "呼叫帮手" : "Call a Helper" }

    // MARK: 权限被拒 / 设备不支持

    static func permTitle(_ l: Language) -> String { l == .zh ? "相机权限被关闭" : "Camera access is off" }
    static func permBody(_ l: Language) -> String {
        l == .zh ? "BeeUrEi 需要使用摄像头来识别前方障碍。请前往「设置」开启相机权限。"
                 : "BeeUrEi needs the camera to detect obstacles ahead. Please enable camera access in Settings."
    }
    static func openSettings(_ l: Language) -> String { l == .zh ? "打开设置" : "Open Settings" }
    static func permAnnounce(_ l: Language) -> String {
        l == .zh ? "相机权限被关闭，避障已停止。请到设置开启相机权限，或呼叫帮手。"
                 : "Camera access is off and obstacle detection has stopped. Enable camera access in Settings, or call a helper."
    }
    static func unsupportedTitle(_ l: Language) -> String { l == .zh ? "设备不支持" : "Device not supported" }
    static func unsupportedAnnounce(_ message: String, _ l: Language) -> String {
        l == .zh ? "设备不支持避障。\(message)" : "Obstacle detection isn't available on this device. \(message)"
    }
    static func noLiDARMessage(_ l: Language) -> String {
        l == .zh ? "此设备没有 LiDAR。BeeUrEi 仅支持带 LiDAR 的 iPhone（iPhone 12 Pro 及更新的 Pro 机型）。"
                 : "This device has no LiDAR. BeeUrEi requires a LiDAR iPhone (iPhone 12 Pro or newer Pro models)."
    }
}
