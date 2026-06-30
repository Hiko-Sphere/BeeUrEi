import Foundation

/// 导航/回程/预览播报文案中心表——E5 多语言主线第二批（与 FramingStrings 同模式）。
/// 此前导航屏全部硬编码中文；NavVoice 嗓音已随语言，这里补齐文案本身。中文输出与历史完全一致。
/// 注：转向指令本体来自路线源（国内高德为中文；海外 MapKit 由系统本地化），这里只管包装语。
enum NavStrings {

    // MARK: 状态

    static func idleStatus(_ l: Language) -> String {
        l == .zh ? "输入目的地后开始导航" : "Enter a destination to start"
    }
    static func enableFirst(_ l: Language) -> String {
        l == .zh ? "请先在「设置 → 功能」开启步行导航" : "Enable walking navigation in Settings → Features first"
    }
    static func enterDestination(_ l: Language) -> String { l == .zh ? "请输入目的地" : "Please enter a destination" }
    static func locating(_ l: Language) -> String { l == .zh ? "正在定位…" : "Locating…" }
    static func navStopped(_ l: Language) -> String { l == .zh ? "导航已停止" : "Navigation stopped" }
    static func locationDenied(_ l: Language) -> String {
        l == .zh ? "需要定位权限才能导航，请在系统设置开启定位。"
                 : "Location access is needed for navigation. Enable Location in Settings."
    }
    static func navStoppedForNew(_ l: Language) -> String { l == .zh ? "已停止当前导航" : "Stopped the current navigation" }
    static func offRoute(_ l: Language) -> String { l == .zh ? "已偏离路线，正在重新规划" : "Off route — replanning" }
    static func nearDestination(_ l: Language) -> String { l == .zh ? "已接近目的地" : "You're near the destination" }
    static func approachingDestination(_ l: Language) -> String {
        l == .zh ? "正在接近目的地" : "Approaching the destination"
    }
    static func noWalkingRoute(_ l: Language) -> String { l == .zh ? "未找到步行路线" : "No walking route found" }
    static func chinaRouteFailed(_ l: Language) -> String {
        l == .zh ? "国内路线获取失败（需登录并连接后端）"
                 : "Couldn't fetch the route in China (sign in and connect to the backend)"
    }
    static func destinationNotFound(_ l: Language) -> String { l == .zh ? "找不到目的地" : "Destination not found" }
    /// 高德服务侧错误（最常见：后端 AMAP_API_KEY 不是「Web服务」类型）。与"找不到目的地"区分，避免误导用户改地址。
    static func navServiceUnavailable(_ l: Language) -> String {
        l == .zh ? "导航服务暂时不可用，请稍后再试" : "Navigation service is temporarily unavailable, please try again later"
    }

    // MARK: 导航开始

    static func navStartedStatus(_ n: Int, _ l: Language) -> String {
        l == .zh ? "导航开始，共 \(n) 步" : "Navigation started — \(n) steps"
    }
    static func navStartedSpeak(_ n: Int, _ first: String, _ l: Language) -> String {
        l == .zh ? "导航开始，共\(n)步。\(first)" : "Navigation started, \(n) steps. \(first)"
    }
    static func staticRouteStatus(_ n: Int, _ l: Language) -> String {
        l == .zh ? "共 \(n) 步（静态路线）" : "\(n) steps (static route)"
    }
    static func staticRouteSpeak(_ n: Int, _ first: String, _ l: Language) -> String {
        l == .zh ? "共\(n)步。第一步：\(first)" : "\(n) steps. First: \(first)"
    }

    // MARK: 街景预览

    static func planningPreview(_ l: Language) -> String { l == .zh ? "正在规划预览路线…" : "Planning the preview route…" }
    static func previewStopped(_ l: Language) -> String { l == .zh ? "已停止预览" : "Preview stopped" }
    static func noPreviewRoute(_ l: Language) -> String { l == .zh ? "没有可预览的路线" : "No route to preview" }
    static func previewingStatus(steps: Int, meters: Int, _ l: Language) -> String {
        l == .zh ? "路线预览中：共 \(steps) 步，约 \(meters) 米" : "Previewing: \(steps) steps, about \(meters) m"
    }
    static func previewStartSpeak(meters: Int, steps: Int, _ l: Language) -> String {
        l == .zh ? "路线预览开始。全程约\(meters)米，共\(steps)步。"
                 : "Route preview. About \(meters) meters in \(steps) steps."
    }
    static func previewEndSpeak(_ l: Language) -> String {
        l == .zh ? "预览结束。准备好后，点开始导航。" : "Preview finished. Tap Start Navigation when ready."
    }
    static func previewStep(_ n: Int, _ instruction: String, meters: Int, _ l: Language) -> String {
        l == .zh ? "第\(n)步，\(instruction)，前行约\(meters)米。" : "Step \(n): \(instruction), go about \(meters) meters."
    }

    // MARK: 记路 / 原路返回（面包屑）

    static func trailRecordingStatus(_ l: Language) -> String {
        l == .zh ? "记路中：沿途位置会被记录，回程时点「原路返回」" : "Recording the trail — tap Backtrack to return later"
    }
    static func trailStartSpeak(_ l: Language) -> String {
        l == .zh ? "开始记路。走吧，我会记住来路。" : "Trail recording started. Walk on — I'll remember the way."
    }
    static func trailProgress(_ n: Int, _ l: Language) -> String {
        l == .zh ? "记路中：已记 \(n) 个点" : "Recording: \(n) points"
    }
    static func trailStopStatus(_ n: Int, _ l: Language) -> String {
        l == .zh ? "已记 \(n) 个点，可点「原路返回」" : "\(n) points recorded — you can backtrack now"
    }
    static func trailTooFew(_ l: Language) -> String {
        l == .zh ? "记录点太少，暂无法回程" : "Too few points to backtrack yet"
    }
    static func noTrailYet(_ l: Language) -> String {
        l == .zh ? "还没有记录来路，请先「开始记路」" : "No trail recorded yet — start recording first"
    }
    static func backtrackStatus(_ n: Int, _ l: Language) -> String {
        l == .zh ? "原路返回：跟着提示音走，共 \(n) 个路点" : "Backtracking: follow the beacon, \(n) waypoints"
    }
    static func backtrackStartSpeak(_ l: Language) -> String {
        l == .zh ? "开始原路返回。跟着提示音的方向走。" : "Backtracking started. Follow the beacon sound."
    }
    static func backtrackInstruction(_ l: Language) -> String { l == .zh ? "沿原路继续" : "Continue along the trail" }
    static func backtrackDestinationName(_ l: Language) -> String { l == .zh ? "回到出发点" : "Back to start" }

    // MARK: 沿途 callout

    static func passingBy(_ name: String, _ l: Language) -> String { l == .zh ? "途经\(name)" : "Passing \(name)" }
    static func enteringRoad(_ name: String, _ l: Language) -> String { l == .zh ? "进入\(name)" : "Entering \(name)" }

    /// 步骤列表行："右转（30 米）" / "Turn right (30 m)"。
    static func stepListItem(_ instruction: String, meters: Int, _ l: Language) -> String {
        l == .zh ? "\(instruction)（\(meters) 米）" : "\(instruction) (\(meters) m)"
    }

    // MARK: 导航屏界面文案（E5）

    static func regionHeader(_ l: Language) -> String { l == .zh ? "地区" : "Region" }
    static func regionOverseas(_ l: Language) -> String { l == .zh ? "海外（MapKit）" : "Overseas (MapKit)" }
    static func regionChina(_ l: Language) -> String { l == .zh ? "中国大陆（高德）" : "Mainland China (AMap)" }
    /// 跟随系统区域自动判定（中国大陆→高德，其余→MapKit）。设置页地区选择器的默认项。
    static func regionAuto(_ l: Language) -> String { l == .zh ? "自动（按系统区域）" : "Automatic (by system region)" }
    /// 设置页地区选择器的行标签（与分区标题「地区」区分，避免 VoiceOver 连读两个「地区」）。
    static func regionPickerLabel(_ l: Language) -> String { l == .zh ? "地图来源" : "Map source" }
    static func regionFooter(_ l: Language) -> String {
        l == .zh ? "决定步行导航用哪家地图：中国大陆用高德，海外用 Apple 地图。通常自动判定即可，很少需要手动更改。"
                 : "Chooses the map source for walking navigation: AMap in mainland China, Apple Maps overseas. Auto-detected by default; rarely needs changing."
    }
    static func destinationHeader(_ l: Language) -> String { l == .zh ? "目的地" : "Destination" }
    static func destinationPlaceholder(_ l: Language) -> String {
        l == .zh ? "如：地铁站、超市名称" : "e.g. metro station, supermarket"
    }
    static func stopPreview(_ l: Language) -> String { l == .zh ? "停止预览" : "Stop Preview" }
    static func startNav(_ l: Language) -> String { l == .zh ? "开始导航" : "Start Navigation" }
    static func previewRoute(_ l: Language) -> String { l == .zh ? "预览路线（出门前试听）" : "Preview Route (listen first)" }
    static func previewHint(_ l: Language) -> String {
        l == .zh ? "不出门，先把整条路线逐步念给你听：每一步怎么走、走多远、全程多长"
                 : "Without going out, hear the whole route step by step: each turn, each distance, and the total length"
    }
    static func stopNav(_ l: Language) -> String { l == .zh ? "停止导航" : "Stop Navigation" }
    static func startTrail(_ l: Language) -> String { l == .zh ? "开始记路" : "Start Recording Trail" }
    static func startTrailHint(_ l: Language) -> String {
        l == .zh ? "沿途记录你的来路，回程时可原路返回" : "Records your path so you can backtrack later"
    }
    static func stopTrail(_ l: Language) -> String { l == .zh ? "停止记路" : "Stop Recording" }
    static func backtrack(_ n: Int, _ l: Language) -> String {
        l == .zh ? "原路返回（已记 \(n) 个点）" : "Backtrack (\(n) points recorded)"
    }
    static func backtrackHint(_ l: Language) -> String {
        l == .zh ? "沿记录的来路反向引导你走回出发点" : "Guides you back along the recorded path to your start"
    }
    static func clearTrail(_ l: Language) -> String { l == .zh ? "清除已记路线" : "Clear Recorded Trail" }
    static func clearTrailHint(_ l: Language) -> String {
        l == .zh ? "删除已记录的来路，不再可原路返回" : "Discards the recorded path; backtrack will be unavailable"
    }
    static func trailCleared(_ l: Language) -> String { l == .zh ? "已清除记录的路线" : "Recorded trail cleared" }
    static func backtrackHeader(_ l: Language) -> String { l == .zh ? "原路返回" : "Backtrack" }
    static func backtrackFooter(_ l: Language) -> String {
        l == .zh ? "进陌生地方前点「开始记路」；要回去时点「原路返回」，跟着提示音原路走回出发点。"
                 : "Tap \"Start Recording Trail\" before entering an unfamiliar place; tap \"Backtrack\" to follow the beacon back to where you started."
    }
    static func favoritesHeader(_ l: Language) -> String { l == .zh ? "常用目的地" : "Favorite destinations" }
    static func statusHeader(_ l: Language) -> String { l == .zh ? "状态" : "Status" }
    static func stepsHeader(_ l: Language) -> String { l == .zh ? "路线步骤" : "Route steps" }
    static func navScreenTitle(_ l: Language) -> String { l == .zh ? "步行导航" : "Walking Navigation" }
    static func done(_ l: Language) -> String { l == .zh ? "完成" : "Done" }

    /// 反向地理编码/POI 查询的地名语言。
    static func geocodeLocale(_ l: Language) -> Locale {
        Locale(identifier: l == .zh ? "zh_CN" : "en_US")
    }
}
