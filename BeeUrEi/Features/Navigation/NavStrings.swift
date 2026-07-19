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
    /// Magic Tap 状态回述：走路时一手势重播"下一步转向 + 还有多远/ETA"（盲人随时想确认，此前只能自动里程碑播报
    /// 或去屏上找那行文字）。转向/剩余都空(刚起步/定位中)时回落状态行或"正在定位…"——手势必须永远有语音反馈，
    /// 静默会让盲人以为没生效。
    /// arrivalClock：预计到达的本地化时钟时刻（"下午3:25"/"3:25 PM"）；有 core 内容且有到达时刻时附「预计X到达」。
    /// 途中"重听"报到达时间尤有用（比"还有4分钟"更省心算、更能判断能否赶上约定）。刚起步/定位中(core 空)不附。
    static func statusRecap(instruction: String, remaining: String, status: String, arrivalClock: String? = nil, _ l: Language) -> String {
        let core = [instruction, remaining].filter { !$0.isEmpty }.joined(separator: "。")
        if !core.isEmpty {
            guard let clock = arrivalClock else { return core }
            return core + (l == .zh ? "。预计\(clock)到达" : ". Arriving around \(clock)")
        }
        return status.isEmpty ? locating(l) : status
    }
    /// 可见"重听"按钮标题：Magic Tap 只是 VoiceOver 手势、很多人不知道，不用 VoiceOver 的盲人更无从触发；
    /// 提供可达按钮走路时随时重播状态（与 Magic Tap 同调 statusRecap）。
    static func repeatStatus(_ l: Language) -> String { l == .zh ? "重听下一步和还有多远" : "Repeat next step and distance" }
    static func navStopped(_ l: Language) -> String { l == .zh ? "导航已停止" : "Navigation stopped" }
    static func locationDenied(_ l: Language) -> String {
        l == .zh ? "需要定位权限才能导航，请在系统设置开启定位。"
                 : "Location access is needed for navigation. Enable Location in Settings."
    }
    /// 聊天位置卡上的"用蜂之眼导航去这里"（收到亲友位置后直接用**盲人优化导航**过去，而非只能跳 Apple 地图）。
    static func navigateHereFromChat(_ l: Language) -> String {
        l == .zh ? "用蜂之眼导航去这里" : "Navigate there with BeeUrEi"
    }
    /// 收到分享位置的**公交**出行入口：步行只覆盖短途，跨城赴约（"我在城那头等你"）须公交——朗读整段换乘路线。
    static func transitHereFromChat(_ l: Language) -> String {
        l == .zh ? "坐公交/地铁前往这里" : "Take transit there"
    }

    /// 仅粗略定位（用户关了「精确位置」）：逐步导航无法进行，给**可操作**指引（去设置开精确位置）。
    /// 不是"定位中"或"精度低"那种会自愈的临时话——这是个用户能一步修好的设置。
    static func preciseLocationNeeded(_ l: Language) -> String {
        l == .zh ? "当前只能大致定位，无法逐步引导。请到系统设置 → 蜂之眼 → 位置，打开「精确位置」。"
                 : "Only approximate location is available, so turn-by-turn guidance can't run. In Settings → BeeUrEi → Location, turn on Precise Location."
    }
    static func navStoppedForNew(_ l: Language) -> String { l == .zh ? "已停止当前导航" : "Stopped the current navigation" }
    static func offRoute(_ l: Language) -> String { l == .zh ? "已偏离路线，正在重新规划" : "Off route — replanning" }
    // 自定义路线（路线库）偏航：不重规划，汇入或原路返回（评审安全不变量）。
    static func rejoinRoute(_ l: Language) -> String { l == .zh ? "已偏离路线，带你回到最近的路线点" : "Off route — guiding you back to the nearest route point" }
    static func offRouteReturnToPath(_ l: Language) -> String { l == .zh ? "已偏离路线较远，请沿原路返回" : "You are far off the route — please retrace your steps" }
    static func customRouteInstruction(_ l: Language) -> String { l == .zh ? "沿路线继续" : "Continue along the route" }
    static func customRouteStatus(_ name: String, _ n: Int, _ l: Language) -> String {
        l == .zh ? "沿路线「\(name)」引导中（\(n) 个路线点）" : "Following route \(name) (\(n) \(SpokenStrings.enPlural(n, "point")))"
    }
    static func customRouteStartSpeak(_ name: String, _ l: Language) -> String {
        l == .zh ? "开始沿路线\(name)引导，请跟随提示音方向" : "Starting route \(name) — follow the beacon"
    }
    static func myRoutesHeader(_ l: Language) -> String { l == .zh ? "我的路线" : "My routes" }
    static func routesEmpty(_ l: Language) -> String { l == .zh ? "还没有保存的路线。亲友可在网页端为你绘制常走路线。" : "No saved routes yet. Family can draw routes for you on the web." }
    static func routesLoadFailed(_ l: Language) -> String { l == .zh ? "路线加载失败" : "Failed to load routes" }
    static func routesLoadFailedRetry(_ l: Language) -> String { l == .zh ? "路线加载失败，点此重试" : "Failed to load routes — tap to retry" }
    static func routesRetryHint(_ l: Language) -> String { l == .zh ? "点两下重新加载路线" : "Double-tap to reload routes" }
    static func routesLoading(_ l: Language) -> String { l == .zh ? "正在加载路线…" : "Loading routes…" }
    // 断网降级（缓存路线，#8）：明确告知"用的是旧路线"与风险——绝不静默换路线。
    static func offlineRouteFallbackSpeak(_ days: Int, _ l: Language) -> String {
        if l == .zh {
            let age = days <= 0 ? "今天" : "\(days) 天前"
            return "网络不可用，改用\(age)缓存的路线引导。注意，道路情况可能已变化，请谨慎慢行"
        }
        let age = days <= 0 ? "today" : "\(days) day\(days == 1 ? "" : "s") ago"
        return "Network unavailable — using the route cached \(age). Roads may have changed, please walk carefully"
    }
    static func offlineRouteStatus(_ n: Int, _ l: Language) -> String {
        l == .zh ? "离线路线引导中（\(n) 个转向点）" : "Offline route guidance (\(n) turns)"
    }
    static func routePointCount(_ n: Int, _ l: Language) -> String { l == .zh ? "\(n) 个路线点" : "\(n) \(SpokenStrings.enPlural(n, "point"))" }
    static func routePreviewHint(_ name: String, _ l: Language) -> String {
        l == .zh ? "不走路，先听一遍\(name)的全程" : "Hear the whole \(name) route without walking it"
    }
    /// 步行时间可读短语（"步行约 15 分钟" / "步行约 1 小时 5 分钟"）：≥60 分钟拆成"X 小时 Y 分钟"，
    /// 与网页端 Routes 页 `routeWalkingText` **逐字对齐**——同一条路线在盲人 iOS 与亲友网页读法一致。
    /// 长路线播报"90 分钟"远不如"1 小时 30 分钟"好懂（盲人靠听，整点更易建立时长概念）。纯逻辑可单测。
    static func walkTimePhrase(minutes mins: Int, _ l: Language) -> String {
        if mins < 60 { return l == .zh ? "步行约 \(mins) 分钟" : "~\(mins) min walk" }
        let h = mins / 60, mm = mins % 60
        if mm == 0 { return l == .zh ? "步行约 \(h) 小时" : "~\(h) h walk" }
        return l == .zh ? "步行约 \(h) 小时 \(mm) 分钟" : "~\(h) h \(mm) min walk"
    }

    /// 路线副标题："N 个路线点" + 创建者（亲友画的→"由 X 创建"；自存→"自存"）。信任透明：盲人须知谁画的。
    /// 路线库副标题："8 个点 · 约1.2 公里 · 步行约 17 分钟 · 由妈妈创建"。
    /// 距离/步行时间在 meters 有效(>0)时才追加（与网页端 Routes 页对齐，补齐盲人端"这条多长/多久"的展示缺口）；
    /// 距离随单位（英制→英尺/英里），步行时间用核心 RouteRemaining.estimatedWalkMinutes（1.2 m/s，跨端一致）。
    static func routeSubtitle(_ n: Int, meters: Double? = nil, by creator: String?, unit: DistanceUnit = .metric, _ l: Language) -> String {
        var head = routePointCount(n, l)
        if let m = meters, m.isFinite, m > 0 {
            head += l == .zh ? " · 约\(distancePhrase(meters: Int(m.rounded()), unit: unit, l))" : " · ~\(distancePhrase(meters: Int(m.rounded()), unit: unit, l))"
            if let mins = RouteRemaining.estimatedWalkMinutes(meters: m) {
                head += " · " + walkTimePhrase(minutes: mins, l)
            }
        }
        if let c = creator, !c.isEmpty { return l == .zh ? "\(head) · 由\(c)创建" : "\(head) · by \(c)" }
        return l == .zh ? "\(head) · 自存" : "\(head) · saved by you"
    }
    static func routeItemA11y(_ name: String, _ n: Int, meters: Double? = nil, by creator: String?, unit: DistanceUnit = .metric, _ l: Language) -> String {
        let who = (creator?.isEmpty == false) ? (l == .zh ? "由\(creator!)创建，" : "created by \(creator!), ") : ""
        var howFar = ""
        if let m = meters, m.isFinite, m > 0 {
            let dist = distancePhrase(meters: Int(m.rounded()), unit: unit, l)
            let mins = RouteRemaining.estimatedWalkMinutes(meters: m)
            if l == .zh { howFar = "约\(dist)，" + (mins.map { walkTimePhrase(minutes: $0, l) + "，" } ?? "") }
            else { howFar = "about \(dist), " + (mins.map { walkTimePhrase(minutes: $0, l) + ", " } ?? "") }
        }
        return l == .zh ? "路线\(name)，\(n) 个路线点，\(howFar)\(who)双击开始引导" : "Route \(name), \(n) \(SpokenStrings.enPlural(n, "point")), \(howFar)\(who)double-tap to start"
    }
    static func nearDestination(_ l: Language) -> String { l == .zh ? "已接近目的地" : "You're near the destination" }
    /// 到达播报**带目的地名**：盲人看不到自己到没到、也无从确认到的是不是**对**的地方——念出目的地名（"已接近
    /// 目的地：协和医院"）让他一听即知到对了。名字空（理论上不该发生）→ 回退通用"已接近目的地"。纯逻辑可单测。
    static func arrivedNear(destinationName: String, _ l: Language) -> String {
        let name = destinationName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return nearDestination(l) }
        return l == .zh ? "已接近目的地：\(name)" : "You're near your destination: \(name)"
    }
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
    /// 目的地回读确认前缀（仅按**名字**导航时有 name）：出发前先念高德规范化全称，让盲人核对——高德可能把
    /// "协和医院"匹配到别区同名分院，一听全称即知走错、可及时停下。精确坐标导航（聊天分享位置）无 name → 空、
    /// 自然跳过。拼在 navStarted/staticRoute 播报**之前**成同一句（SpeechHub .query 替换语义，分两次 speak 会互顶）。
    static func destinationConfirmation(_ name: String?, _ l: Language) -> String {
        guard let n = name?.trimmingCharacters(in: .whitespacesAndNewlines), !n.isEmpty else { return "" }
        return l == .zh ? "导航到\(n)。" : "Heading to \(n). "
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
        l == .zh ? "记路中：已记 \(n) 个点" : "Recording: \(n) \(SpokenStrings.enPlural(n, "point"))"
    }
    static func trailStopStatus(_ n: Int, _ l: Language) -> String {
        l == .zh ? "已记 \(n) 个点，可点「原路返回」" : "\(n) \(SpokenStrings.enPlural(n, "point")) recorded — you can backtrack now"
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

    // 罗盘持续不可信时告知盲人（系统「图-8」校准 UI 是视觉的，盲人看不到）：说清方向提示为何停 + 怎么修。
    static func compassUnreliable(_ l: Language) -> String {
        l == .zh ? "指南针受干扰，方向提示暂停。请把手机拿离金属或磁铁，或握着手机在空中画几个 8 字来校准。"
                 : "Compass interference — direction cues paused. Move your phone away from metal or magnets, or wave it in a figure-eight to recalibrate."
    }
    static func compassRestored(_ l: Language) -> String {
        l == .zh ? "指南针已恢复，方向提示继续。" : "Compass restored — direction cues resumed."
    }
    static func gpsSignalWeak(_ l: Language) -> String {
        l == .zh ? "定位信号弱，方向提示暂停。请留在原地稍等，信号恢复后我会继续引导。"
                 : "Weak location signal — direction cues paused. Please stay where you are; I'll resume once the signal recovers."
    }
    static func gpsSignalRestored(_ l: Language) -> String {
        l == .zh ? "定位已恢复，继续引导。" : "Location restored — resuming guidance."
    }

    // MARK: 沿途 callout

    static func passingBy(_ name: String, _ l: Language) -> String { l == .zh ? "途经\(name)" : "Passing \(name)" }
    static func enteringRoad(_ name: String, _ l: Language) -> String { l == .zh ? "进入\(name)" : "Entering \(name)" }

    /// 距离短语："1.2 公里"（≥1km 用公里一位小数）/ "300 米"（≥10m 取整到 10 米）/ "4 米"（<10m 报精确值）。
    /// 英制（英语盲人对标 Soundscape/Apple/Google Maps 均念英尺/英里）：委托 DistanceUnit.farDistance
    /// （<1000ft 念英尺、≥ 念英里，溢出/非有限安全）。公制分支保持历史口径**逐字节不变**（10 米取整/末段精确/
    /// 公里一位小数），只在用户显式选英制时切换——不打扰现有用户。
    private static func distancePhrase(meters: Int, unit: DistanceUnit = .metric, _ l: Language) -> String {
        if unit == .imperial {
            // 末段临门一脚：英尺分辨率天然更细（1m≈3.3ft），farDistance 取整到 1 英尺不会把几步抹成 0。
            return DistanceUnit.imperial.farDistance(meters: Double(max(0, meters)), language: l)
        }
        if meters >= 1000 {
            let km = (Double(meters) / 100).rounded() / 10   // 一位小数
            return l == .zh ? "\(km) 公里" : "\(km) km"
        }
        // <10 米：报**精确**值——末段临门一脚是最要紧的近距，取整到 10 会把 1–4 米抹成"还有约 0 米"
        // （荒谬且误导：明明还有几步却说 0，盲人找门的关键时刻反被坑）。max(0,) 防越过点的负值噪声。
        if meters < 10 {
            let m = max(0, meters)
            return l == .zh ? "\(m) 米" : "\(m) m"
        }
        let m = Int((Double(meters) / 10).rounded()) * 10    // 取整到 10 米
        return l == .zh ? "\(m) 米" : "\(m) m"
    }

    /// ETA 短语（缺测/非有限→nil，调用方省略）："预计 4 分钟" / "预计不到 1 分钟"。
    private static func etaPhrase(_ etaSeconds: Double?, _ l: Language) -> String? {
        guard let eta = etaSeconds, eta.isFinite, eta >= 0 else { return nil }
        if eta < 60 { return l == .zh ? "预计不到 1 分钟" : "~under a minute" }
        let mins = Int((eta / 60).rounded())
        return l == .zh ? "预计 \(mins) 分钟" : "~\(mins) min"
    }

    /// 剩余路程 + 预计到达播报（导航中跨里程碑时报一次）："还有约 300 米，预计 4 分钟"。
    /// 末段（≤30 米）加"快到了"前缀——50 之后临近到达，盲人最想听到的语义提示（放慢、准备找门）。
    static func remainingDistance(meters: Int, etaSeconds: Double?, unit: DistanceUnit = .metric, _ l: Language) -> String {
        let dist = distancePhrase(meters: meters, unit: unit, l)
        let nearPrefix = meters <= 30 ? (l == .zh ? "快到了，" : "Almost there — ") : ""
        guard let eta = etaPhrase(etaSeconds, l) else {
            return l == .zh ? "\(nearPrefix)还有约\(dist)" : "\(nearPrefix)about \(dist) to go"
        }
        return l == .zh ? "\(nearPrefix)还有约\(dist)，\(eta)" : "\(nearPrefix)about \(dist) to go, \(eta)"
    }

    /// 出发时的全程概览（导航开始先报整条路线长度与预计时长，给盲人整体预期）："全程约 1.2 公里，预计 15 分钟"。
    /// 竞品(Apple/Google/Soundscape)均在开始导航时先报路线总览；ETA 为初始估计（尚未起步、用默认步速）。
    /// arrivalClock：预计到达的**本地化时钟时刻**（如"下午3:25"/"3:25 PM"，由调用方按用户 locale 格式化）。
    /// 出发前给"预计几点到达"——对标 Google/Apple 地图；盲人据此判断能否赶上约定，省去"现在几点+还有几分钟"的心算。
    /// 仅在有有效 ETA 时附（无 ETA 连时长都没有，更谈不上到达时刻）。
    static func journeyOverview(meters: Int, etaSeconds: Double?, arrivalClock: String? = nil, unit: DistanceUnit = .metric, _ l: Language) -> String {
        let dist = distancePhrase(meters: meters, unit: unit, l)
        guard let eta = etaPhrase(etaSeconds, l) else {
            return l == .zh ? "全程约\(dist)" : "Route is about \(dist)"
        }
        let arrival = arrivalClock.map { l == .zh ? "，预计\($0)到达" : ", arriving around \($0)" } ?? ""
        return l == .zh ? "全程约\(dist)，\(eta)\(arrival)" : "Route is about \(dist), \(eta)\(arrival)"
    }

    /// 步骤列表行："右转（30 米）" / "Turn right (30 m)"。英制用英尺/英里（与播报口径一致）。
    static func stepListItem(_ instruction: String, meters: Int, unit: DistanceUnit = .metric, _ l: Language) -> String {
        if unit == .imperial {
            let d = DistanceUnit.imperial.farDistance(meters: Double(max(0, meters)), language: l)
            return l == .zh ? "\(instruction)（\(d)）" : "\(instruction) (\(d))"
        }
        return l == .zh ? "\(instruction)（\(meters) 米）" : "\(instruction) (\(meters) m)"
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
        l == .zh ? "原路返回（已记 \(n) 个点）" : "Backtrack (\(n) \(SpokenStrings.enPlural(n, "point")) recorded)"
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

    /// 语音"走X路线"未匹配到唯一一条：读出全部已存路线名让用户再说一遍（宁可不选也不选错——
    /// 人工路线是安全路径，走错一条比没走上更危险）。无任何路线时引导去建。
    static func savedRouteNotFound(_ spoken: String, names: [String], _ l: Language) -> String {
        if names.isEmpty {
            return l == .zh ? "你还没有保存的路线。可以请亲友在网页端替你画一条常走路线。"
                            : "You have no saved routes yet. Ask a family member to draw one for you on the web."
        }
        let list = names.joined(separator: l == .zh ? "、" : ", ")
        return l == .zh ? "没有找到叫\u{201C}\(spoken)\u{201D}的路线。你保存的路线有：\(list)。请再说一遍路线名。"
                        : "No route called \u{201C}\(spoken)\u{201D}. Your saved routes are: \(list). Please say the route name again."
    }

    /// 反向地理编码/POI 查询的地名语言。
    static func geocodeLocale(_ l: Language) -> Locale {
        Locale(identifier: l == .zh ? "zh_CN" : "en_US")
    }
}
