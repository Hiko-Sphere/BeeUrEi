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

    /// 反向地理编码/POI 查询的地名语言。
    static func geocodeLocale(_ l: Language) -> Locale {
        Locale(identifier: l == .zh ? "zh_CN" : "en_US")
    }
}
