import Foundation

/// 实时位置共享界面文案（双语，随 FeatureSettings 语言）。
enum LiveLocationStrings {
    static func navTitle(_ l: Language) -> String { l == .zh ? "实时位置" : "Live location" }
    static func subtitle(_ l: Language) -> String {
        l == .zh ? "与你的亲友/协助者互相共享当前位置。仅已绑定的联系人可见，停止后立即不可见。"
                 : "Share your live location with your contacts. Only linked contacts can see it; it stops being visible instantly when you turn it off."
    }

    static func startSharing(_ l: Language) -> String { l == .zh ? "开始共享位置" : "Share my location" }
    static func stopSharing(_ l: Language) -> String { l == .zh ? "停止共享" : "Stop sharing" }
    static func sharingTitle(_ l: Language) -> String { l == .zh ? "正在共享你的位置" : "Sharing your location" }
    static func notSharingTitle(_ l: Language) -> String { l == .zh ? "未共享" : "Not sharing" }
    static func sharingHint(_ l: Language) -> String { l == .zh ? "开启后联系人可看到你的实时位置" : "Contacts will see your live position" }
    static func sharingUntil(_ time: String, _ l: Language) -> String { l == .zh ? "将持续到 \(time)" : "Until \(time)" }

    static func startedSpeak(_ l: Language) -> String { l == .zh ? "已开始共享你的实时位置" : "Started sharing your live location" }
    static func stoppedSpeak(_ l: Language) -> String { l == .zh ? "已停止共享位置" : "Stopped sharing your location" }
    static func permissionDenied(_ l: Language) -> String {
        l == .zh ? "定位权限被关闭，请在系统设置中允许 BeeUrEi 使用定位" : "Location permission is off. Allow BeeUrEi to use your location in Settings."
    }

    static func contactsHeader(_ l: Language) -> String { l == .zh ? "正在共享的联系人" : "Contacts sharing now" }
    static func noContactsTitle(_ l: Language) -> String { l == .zh ? "暂无联系人在共享位置" : "No contacts sharing" }
    static func noContactsMessage(_ l: Language) -> String { l == .zh ? "当联系人开启共享时，会显示在地图与此处" : "They appear here and on the map when sharing" }

    static func updatedAgo(_ seconds: Int, _ l: Language) -> String {
        if seconds < 60 { return l == .zh ? "刚刚更新" : "updated just now" }
        let m = seconds / 60
        return l == .zh ? "\(m) 分钟前更新" : "updated \(m)m ago"
    }

    /// 距离 + 方位的可读描述（盲人侧 VoiceOver/语音）："约 200 米，在你的东北方向"。
    static func distanceBearing(meters: Int, bearing: String, _ l: Language) -> String {
        l == .zh ? "约 \(meters) 米，在你的\(bearing)" : "about \(meters) m to your \(bearing)"
    }
    static func distanceUnknown(_ l: Language) -> String { l == .zh ? "距离未知（需开启你自己的定位）" : "distance unknown (enable your own location)" }

    /// 八方位中文/英文。委托核心 CompassRose（含 isFinite 守卫）——非有限方位（NaN，如同点/坏坐标算出的
    /// bearing）退化为"方向未知"而非 `Int(NaN)` 陷阱崩溃（历史坑：此处原直接 Int(...) 无守卫）。
    static func compass(_ degrees: Double, _ l: Language) -> String {
        CompassRose.cardinal(degrees: degrees, language: l) ?? (l == .zh ? "方向未知" : "unknown direction")
    }

    /// 对端电量文案（0–100 之外/未知返回 nil：老客户端不上报，不显示不猜）。≤20% 点明"偏低"——
    /// 尤其 VoiceOver 用户听不到"红色"，语义必须在文字里（趁对方手机没电失联前主动联系）。
    static func batteryText(_ pct: Int?, _ l: Language) -> String? {
        guard let pct, (0...100).contains(pct) else { return nil }
        if pct <= 20 { return l == .zh ? "电量 \(pct)%，偏低" : "battery \(pct)%, low" }
        return l == .zh ? "电量 \(pct)%" : "battery \(pct)%"
    }

    /// 联系人单元的合并无障碍标签（battery 为 nil 时不含电量段）。
    static func contactA11y(name: String, role: String, distance: String, updated: String, battery: String? = nil, _ l: Language) -> String {
        let base = l == .zh ? "\(name)，\(role)，\(distance)，\(updated)" : "\(name), \(role), \(distance), \(updated)"
        guard let battery else { return base }
        return l == .zh ? "\(base)，\(battery)" : "\(base), \(battery)"
    }

    static func featureOffTitle(_ l: Language) -> String { l == .zh ? "位置共享已关闭" : "Location sharing is off" }
    static func featureOffMessage(_ l: Language) -> String { l == .zh ? "管理员已停用该功能" : "Disabled by the administrator" }

    /// 入口按钮（角色主界面）。
    static func entryTitle(_ l: Language) -> String { l == .zh ? "实时位置共享" : "Live location sharing" }
    static func entrySubtitle(_ l: Language) -> String { l == .zh ? "与亲友/协助者互看位置" : "See each other’s live location" }
}
