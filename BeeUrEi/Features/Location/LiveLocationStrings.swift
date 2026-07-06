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
    /// 服务端因有效期到期/管理员下线而停掉共享时告知盲人——否则以为家人还看得到自己（假安心，紧急时尤险）。
    static func expiredSpeak(_ l: Language) -> String {
        l == .zh ? "位置共享已结束，家人暂时看不到你的位置。需要的话可以重新开启共享。"
                 : "Location sharing has ended — your family can't see you right now. Turn it back on if you still need it."
    }
    /// 到达常用地点（家/公司/自定义 label）自播报——盲人定向确认"我到了X"。
    static func arrivedAtPlace(_ label: String, _ l: Language) -> String { l == .zh ? "你到\(label)了" : "You've arrived at \(label)" }
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

    /// 对端相对本人的移动趋势（据其行进方位 heading 与"本人→对端"方位比对）。盲人靠它判断被追踪的亲友
    /// 是在**靠近还是走远**（等人来/对方离开），比裸方位更可行动——对标 Find My 的"正在靠近"。
    enum RelativeMovement { case approaching, movingAway, crossing }

    /// 分类：heading=对端行进方向（度，0=正北顺时针），bearingToContact="本人→对端"方位。对端朝"对端→本人"
    /// (=bearingToContact+180) 方向走=靠近；朝 bearingToContact 方向走=远离；夹在中间=横向。阈值 60°/120° 留出
    /// 横向"不确定带"，避免把侧向移动硬说成靠近/远离。**非有限输入→crossing**（不误报趋势，与全库非有限守卫一致）。
    static func relativeMovement(headingDegrees heading: Double, bearingToContactDegrees bearing: Double) -> RelativeMovement {
        guard heading.isFinite, bearing.isFinite else { return .crossing }
        let toward = (bearing + 180).truncatingRemainder(dividingBy: 360) // 对端→本人 方向
        var diff = abs(heading - toward).truncatingRemainder(dividingBy: 360)
        if diff > 180 { diff = 360 - diff }
        if diff <= 60 { return .approaching }
        if diff >= 120 { return .movingAway }
        return .crossing
    }

    /// 移动趋势文案后缀（拼在距离/方位后）。横向不播（信息量低、易误导），返回 nil。
    static func movementPhrase(_ m: RelativeMovement, _ l: Language) -> String? {
        switch m {
        case .approaching: return l == .zh ? "，正朝你靠近" : ", approaching you"
        case .movingAway: return l == .zh ? "，正在远离" : ", moving away"
        case .crossing: return nil
        }
    }

    /// 对端电量文案（0–100 之外/未知返回 nil：老客户端不上报，不显示不猜）。≤20% 点明"偏低"——
    /// 尤其 VoiceOver 用户听不到"红色"，语义必须在文字里（趁对方手机没电失联前主动联系）。
    static func batteryText(_ pct: Int?, _ l: Language) -> String? {
        guard let pct, (0...100).contains(pct) else { return nil }
        if pct <= 20 { return l == .zh ? "电量 \(pct)%，偏低" : "battery \(pct)%, low" }
        return l == .zh ? "电量 \(pct)%" : "battery \(pct)%"
    }

    /// 联系人单元的合并无障碍标签（battery 为 nil 时不含电量段）。
    static func contactA11y(name: String, role: String, distance: String, accuracy: String? = nil, updated: String, battery: String? = nil, _ l: Language) -> String {
        let sep = l == .zh ? "，" : ", "
        var base = l == .zh ? "\(name)，\(role)，\(distance)" : "\(name), \(role), \(distance)"
        if let accuracy { base += sep + accuracy }   // 精度紧跟距离/方位——盲人据此知道位置有多准
        base += sep + updated
        if let battery { base += sep + battery }
        return base
    }

    static func featureOffTitle(_ l: Language) -> String { l == .zh ? "位置共享已关闭" : "Location sharing is off" }
    static func featureOffMessage(_ l: Language) -> String { l == .zh ? "管理员已停用该功能" : "Disabled by the administrator" }

    /// 入口按钮（角色主界面）。
    static func entryTitle(_ l: Language) -> String { l == .zh ? "实时位置共享" : "Live location sharing" }
    static func entrySubtitle(_ l: Language) -> String { l == .zh ? "与亲友/协助者互看位置" : "See each other’s live location" }
}
