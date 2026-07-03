import Foundation
import Observation
import AVFoundation
import CoreLocation
import MapKit

/// 面包屑轨迹的**进程内持久存储**：导航视图(sheet)关闭即重建 @State 模型，若把轨迹放在模型里，
/// 记录的路会随 sheet 关闭丢失，导致语音"原路返回"（从主屏开新 sheet）永远拿到空轨迹而失败。
/// 放进单例后：在任一会话记录的路，关掉再开（含语音触发的新 sheet）仍能据此回程。
@MainActor
final class BreadcrumbStore {
    static let shared = BreadcrumbStore()
    var trail = BreadcrumbTrail()
    func reset() { trail = BreadcrumbTrail() } // 清空持久轨迹（测试隔离 / 未来"清除已记路线"入口）
    private init() {}
}

/// 步行导航视图模型。海外用 MapKit（实时转向播报 + **空间音信标** + **偏航重规划** +
/// **AirPods 头追踪**，接已测核心）；国内用高德（经后端，key 在 .env）取步行路线并读出步骤。
@MainActor
@Observable
final class NavigationViewModel {
    enum Region { case overseas, china }

    private(set) var status = NavStrings.idleStatus(FeatureSettings().language)
    private(set) var instruction = ""
    @ObservationIgnored private var lang: Language = FeatureSettings().language // 播报语言（E5，进导航/预览/记路时解析）
    private(set) var steps: [String] = []     // 国内：路线步骤列表（VoiceOver 可读）
    private(set) var running = false
    /// 最近一次**成功建立路线**的目的地查询串——仅成功后才入收藏，避免把找不到的垃圾目的地存进常用（见 P2 审计）。
    private(set) var lastResolvedDestination: String?

    @ObservationIgnored private let service: NavigationServicing
    @ObservationIgnored private let amap = AMapRouteClient()
    @ObservationIgnored private let progress = RouteProgress()
    @ObservationIgnored private let gate = LocationAccuracyGate()
    @ObservationIgnored private let spatial: SpatialCueing
    @ObservationIgnored private let haptics: FeedbackSink   // 转向触觉：嘈杂路口语音听不清时的互补通道（biped/WeWalk 式）
    @ObservationIgnored private let headTracker = HeadTracker()

    /// F1：定位服务/空间音/触觉可注入（mock 驱动门控单测，零音频零定位零触觉引擎）。
    /// 生产默认实现与初始化时序不变。
    init(service: NavigationServicing = NavigationService(),
         spatial: SpatialCueing = SpatialAudioFeedback(),
         haptics: FeedbackSink = HapticFeedback()) {
        self.service = service
        self.spatial = spatial
        self.haptics = haptics
        trailCount = BreadcrumbStore.shared.trail.count // 反映此前会话记录的轨迹（sheet 重开后"原路返回(N点)"按钮即可见）
    }
    @ObservationIgnored private let offRoute = OffRouteDetector()

    @ObservationIgnored private var region: Region = .overseas
    @ObservationIgnored private var destinationQuery = ""
    @ObservationIgnored private var maneuvers: [(coordinate: CLLocationCoordinate2D, instruction: String)] = []
    @ObservationIgnored private var stepIndex = 0
    @ObservationIgnored private var destination: CLLocationCoordinate2D?
    @ObservationIgnored private var routeReady = false
    // 自定义路线（路线库）执行中：偏航走 RouteRejoin 汇入而非重规划——人工踩好的路线是安全路径（评审不变量）。
    @ObservationIgnored private var customRouteActive = false
    @ObservationIgnored private var replanning = false      // 重规划进行中：期间不依旧路线引导（见审查 #2）
    @ObservationIgnored private var navGeneration = 0        // 代次令牌：旧规划任务恢复后比对，过期则丢弃（见审查 #1）
    @ObservationIgnored private var headingFilter = HeadingFilter()
    @ObservationIgnored private var headingReliable = false // 罗盘是否可信（磁干扰时为假，抑制信标，见审查 #3）
    @ObservationIgnored private var lastSpoken = ""

    @ObservationIgnored private var routeCoords: [Coordinate] = []
    @ObservationIgnored private var currentHeading: Double = 0
    @ObservationIgnored private var lastBeacon: TimeInterval = 0
    @ObservationIgnored private var lastOffRouteAnnounce: TimeInterval = 0
    @ObservationIgnored private var lastHeadingTime: TimeInterval = 0   // 最近一次可信航向的时刻(单调钟)；陈旧则抑制信标（见审查 #4）
    @ObservationIgnored private var waypointAdvance = WaypointAdvance() // "越过波谷"几何推进判定（核心，已测；见回归 #1/#2）
    @ObservationIgnored private var offRouteStreak = 0                  // 连续判定偏航的帧数，需≥2 抗单帧抖动（见审查 #3）
    @ObservationIgnored private var lastCallout: TimeInterval = 0       // 沿途地标 callout 节流
    @ObservationIgnored private var lastCalloutName = ""                // 上次报过的地标（不重复报同一个）
    @ObservationIgnored private var calloutBusy = false                 // POI 查询进行中
    @ObservationIgnored private var roadAnnouncer = RoadAnnouncer()     // 路名变化判定（核心，已测）
    @ObservationIgnored private var lastRoadGeocode: TimeInterval = 0   // 上次反向地理编码时刻（CLGeocoder 限速）
    @ObservationIgnored private var roadGeocodeBusy = false             // 反向地理编码进行中
    @ObservationIgnored private let roadGeocoder = CLGeocoder()
    // 面包屑回程（Soundscape 式）：记路 → 一键原路返回。
    private(set) var recordingTrail = false
    private(set) var trailCount = 0
    // 轨迹存进程内单例（见 BreadcrumbStore）：sheet 关闭重建模型后，已记录的路仍在，语音"原路返回"可用。
    private var trail: BreadcrumbTrail {
        get { BreadcrumbStore.shared.trail }
        set { BreadcrumbStore.shared.trail = newValue }
    }
    // 街景预览（Soundscape Street Preview 式）：出门前在家试听整条路线。
    private(set) var previewing = false

    func start(destination query: String, region: Region) async {
        lang = FeatureSettings().language   // 进导航解析一次（设置页改语言后重开生效）
        guard FeatureSettings().navigationEnabled else {
            failStatus(NavStrings.enableFirst(lang)) // 盲人点完按钮须听到原因（见 P1 审计）
            return
        }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { failStatus(NavStrings.enterDestination(lang)); return }

        // 重入保护：导航中再次 start(如点了常用目的地)先彻底停止旧导航，避免新旧目的地状态混合（见审查 #5）。
        if running { stop() }
        navGeneration += 1   // 作废任何仍挂在 await 上的旧规划任务（见审查 #1）

        self.region = region
        self.destinationQuery = trimmed
        customRouteActive = false
        routeReady = false
        replanning = false
        previewing = false  // 直接「开始导航」要清掉残留的预览态（startPreview 在本方法返回后再置位）
        stepIndex = 0
        steps = []
        instruction = ""
        routeCoords = []
        maneuvers = []
        destination = nil        // 关键：清空旧目的地，使新查询会重新 geocode（见审查 #5）
        lastSpoken = ""
        headingReliable = false
        headingFilter = HeadingFilter()
        waypointAdvance.reset()
        offRouteStreak = 0
        lastHeadingTime = 0
        running = true
        status = NavStrings.locating(lang)
        // callout 时钟基线 = 进导航时刻：起步阶段(30/75s)让位给"导航开始/第一步"播报，
        // 也避免首帧即发地理编码/POI 网络请求（单测/弱网下首帧阻塞）。
        lastCallout = ProcessInfo.processInfo.systemUptime
        lastRoadGeocode = ProcessInfo.processInfo.systemUptime

        service.onLocation = { [weak self] loc in self?.handle(loc) }
        service.onHeading = { [weak self] h in
            guard let self else { return }
            // 罗盘不可信(磁干扰/未校准, headingAccuracy<0 或过大)：不更新航向、标记不可信，抑制信标（见审查 #3）。
            if self.headingFilter.isReliable(accuracyDegrees: h.headingAccuracy) {
                let raw = h.trueHeading >= 0 ? h.trueHeading : h.magneticHeading
                self.currentHeading = self.headingFilter.update(headingDegrees: raw, accuracyDegrees: h.headingAccuracy)
                self.headingReliable = true
                self.lastHeadingTime = ProcessInfo.processInfo.systemUptime // 记录可信航向时刻，供信标时效门控（见审查 #4）
            } else {
                self.headingReliable = false
            }
        }
        // AirPods 头追踪驱动空间音听者朝向，使信标保持世界固定（无耳机自动跳过）。
        headTracker.onYaw = { [weak self] yaw in self?.spatial.setListenerYaw(Float(yaw)) }
        // 耳机断连：把听者朝向复位为 0（手机朝向基线），避免信标方向被冻结的旧偏航偏置（见审查 #14）。
        headTracker.onUnavailable = { [weak self] in self?.spatial.setListenerYaw(0) }
        headTracker.start()
        service.onAuthDenied = { [weak self] in self?.handleLocationDenied() }
        service.requestAuthAndStart()
    }

    func stop() {
        running = false
        replanning = false
        navGeneration += 1   // 作废挂起的旧规划任务（见审查 #1）
        service.stop()
        headTracker.stop()
        spatial.stop()   // 释放空间音引擎（见审查 #11）
        NavVoice.shared.stop() // 停掉仍在念的导航指令
        status = NavStrings.navStopped(lang)
    }

    private func handle(_ loc: CLLocation) {
        guard running else { return }

        if !routeReady {
            routeReady = true
            let gen = navGeneration
            Task { await planRoute(from: loc, gen: gen) }
            return
        }

        // 重规划进行中：旧路线已废弃、新路线未就绪，期间绝不按过期路线下达转向/信标（见审查 #2）。
        if replanning { return }

        // 仅海外做实时引导（国内为静态步骤读出）。
        // 海外与国内共用同一实时引导引擎（C1）；国内须先把 GPS(WGS-84) 纠偏到高德坐标系(GCJ-02)，
        // 否则定位点相对路线系统性偏移 100–700 米，逐向引导/偏航检测完全不可用。
        guard let dest = destination else { return }
        let now = ProcessInfo.processInfo.systemUptime // 单调时钟，避免系统时间回拨冻结信标/偏航节流（见审查 #6）
        let (lat, lon): (Double, Double) = {
            let c = loc.coordinate
            guard region == .china else { return (c.latitude, c.longitude) }
            let g = ChinaCoord.wgs84ToGcj02(lat: c.latitude, lon: c.longitude)
            return (g.lat, g.lon)
        }()
        let level = gate.level(horizontalAccuracyMeters: loc.horizontalAccuracy)

        // 偏航检测 → 重新规划（核心 OffRouteDetector，已测）。
        // 安全门控：仅在**精度可信**(level != .none)且有真实折线(>=2 点)时才判定偏航，否则低精度抖动会反复
        // 误判偏航、陷入"误判→重规划→精度仍差→再误判"死循环而长期瘫痪引导（见审查 #3）；并要求连续≥2 帧确认抗单帧抖动。
        // 到达后 maneuvers 为空时 routeCoords 退化为单点 [dest]，不可做折线偏航判定（见审查 #10）。
        if level != .none, routeCoords.count >= 2, offRoute.isOffRoute(lat: lat, lon: lon, route: routeCoords) {
            offRouteStreak += 1
        } else {
            offRouteStreak = 0
        }
        if offRouteStreak >= 2, now - lastOffRouteAnnounce >= 6 {
            lastOffRouteAnnounce = now
            offRouteStreak = 0
            // 自定义路线（路线库）：**绝不重规划**——亲友踩好的路线是经过验证的安全路径，自动重规划会把
            // 盲人引上未验证的路（评审安全不变量）。改为指向最近的前方航点重新汇入（核心 RouteRejoin，已测）；
            // 前方无可达航点（>150m）则明确播报请原路返回，不乱指。
            if customRouteActive {
                // 汇入判定必须用 **maneuvers 的坐标**而非 routeCoords：stepIndex 索引的是 maneuvers。
                // 自定义路线两者恰好等长掩盖了错配——缓存路线（#8 降级）的 routeCoords 是整条折线
                // （偏航检测用，点数远多于转向点），拿折线索引赋给 stepIndex 会指向错误转向点。
                let turnPoints = maneuvers.map { Coordinate(lat: $0.0.latitude, lon: $0.0.longitude) }
                if let idx = RouteRejoin.rejoinIndex(lat: lat, lon: lon, waypoints: turnPoints, currentIndex: stepIndex) {
                    stepIndex = min(idx, maneuvers.count)
                    // 改了目标航点必须重置越过波谷基线：否则陈旧 minDist（偏航时距离已增大）会让下一帧的
                    // "距离回升 > minDist+3m" 立即成立，把刚汇入的航点误判"已越过"而静默跳掉（复审 HIGH）。
                    waypointAdvance.reset()
                    instruction = NavStrings.rejoinRoute(lang)
                    forceSpeak(NavStrings.rejoinRoute(lang))
                } else {
                    instruction = NavStrings.offRouteReturnToPath(lang)
                    forceSpeak(NavStrings.offRouteReturnToPath(lang))
                }
                return
            }
            instruction = NavStrings.offRoute(lang)
            forceSpeak(NavStrings.offRoute(lang))
            replanning = true    // 立即门控住旧路线引导
            routeReady = false   // 下次定位触发重规划
            return
        }

        // 目标点：当前转向点，过完则朝目的地。
        let target = stepIndex < maneuvers.count ? maneuvers[stepIndex].coordinate : dest

        // 空间音信标：方位由"当前 GPS 位置 → 目标"算出，故**位置与罗盘都须可信**才发定向音。
        // level==.none(精度差，位置可能差到隔壁街区)或罗盘不可信/航向陈旧(>5s 无新可信航向)时停发，
        // 避免把稳定的确定性方向挂到错误方位、让盲人跟着走向车道/错误路口（见审查 #2/#4）。
        let headingFresh = now - lastHeadingTime < 5
        if level != .none, headingReliable, headingFresh, now - lastBeacon >= 1.5 {
            lastBeacon = now
            let bearing = Geo.initialBearing(fromLat: lat, fromLon: lon, toLat: target.latitude, toLon: target.longitude)
            let beacon = BeaconDirection(headingDegrees: currentHeading, bearingDegrees: bearing)
            // 距离传给信标：越接近目标音量越大（Phase 2「靠近音量增大」）。
            let targetDist = Geo.distanceMeters(fromLat: lat, fromLon: lon, toLat: target.latitude, toLon: target.longitude)
            spatial.playCue(azimuthDegrees: Float(beacon.relativeAzimuthDegrees), distanceMeters: targetDist)
        }

        // 沿途地标 callout（Soundscape 式，Phase 2 交付物⑥）：精度可信时每 75s 报一次"途经 X"。
        // 经 NavVoice 排队播报（不打断转向指令；避障警告可掐断它）。
        if level == .precise, now - lastCallout >= 75, !calloutBusy {
            lastCallout = now
            calloutBusy = true
            announceNearbyLandmark(at: loc)
        }

        // 路名 callout（VoiceVista/Soundscape 式）：走上新路报"进入 X"，帮助保持方向感。
        // CLGeocoder 有系统级限速：30s 一查 + 单飞；"何时值得说"在核心 RoadAnnouncer（已测防路口漂移连环播）。
        if level != .none, now - lastRoadGeocode >= 30, !roadGeocodeBusy {
            lastRoadGeocode = now
            roadGeocodeBusy = true
            announceRoadChange(at: loc, now: now)
        }

        // 已过完所有转向点：接近目的地判定。**到达=高确定性结论，也要过精度门控**——
        // 否则低精度下单帧 GPS 抖到 15m 内就会误报到达并永久停止导航（见审查 #1）。
        guard stepIndex < maneuvers.count else {
            let toDest = Geo.distanceMeters(fromLat: lat, fromLon: lon, toLat: dest.latitude, toLon: dest.longitude)
            if toDest < 15 {
                if level == .precise {
                    haptics.play(FeedbackEvent(priority: .status, speech: nil)) // 到达触觉确认（1 下）：盲人最需明确知道"到了"
                    speak(NavStrings.nearDestination(lang))
                    stop()
                    status = NavStrings.nearDestination(lang) // 置于 stop() 之后：不被"导航已停止"覆盖（单测揪出）
                } else {
                    status = NavStrings.approachingDestination(lang)   // 精度不足：不轻易宣布到达并终止
                }
            }
            return
        }

        // 转向播报（精度门控，核心 RouteProgress，已测）。
        let next = maneuvers[stepIndex]
        let distance = Geo.distanceMeters(fromLat: lat, fromLon: lon, toLat: next.coordinate.latitude, toLon: next.coordinate.longitude)
        let decision = progress.decide(distanceToManeuverMeters: distance, instruction: next.instruction, level: level, language: lang)
        if decision.shouldAnnounce, let text = decision.text {
            // 触觉须与语音同用去重条件：站在/慢速通过路口时 decide() 每帧都返回同一"现在转向"，
            // 语音靠 lastSpoken 去重只念一次，但触觉若无守卫会每帧狂震（复审 MED）。须在 speak() 前
            // 捕获"本帧是否首次播报此指令"（speak 会把 lastSpoken 改成 text），据此决定是否震。
            let isNewAnnouncement = (text != lastSpoken)
            instruction = text
            speak(text)
            // 高确定性"现在转向"补一记转向触觉（.turn，2 下）：嘈杂路口/车流中语音被淹没时的互补确认
            // （biped/WeWalk 式方向触觉；方向本身由空间音信标编码，触觉作"该转了"的手感提示）。
            // 只在 isHighCertainty 且本帧首次播报时触发——每个转向恰好一记，"前方 X 米"不震。
            if decision.isHighCertainty, isNewAnnouncement { haptics.play(FeedbackEvent(priority: .turn, speech: nil)) }
        }

        // 步进推进——用"越过波谷"几何判定，而非脆弱的"必须命中 5m 窗 + precise"：
        // 记录到当前转向点的历史最近距离 minDist；当用户已足够接近(minDist<=announceWithinMeters)且距离开始
        // 明显回升(distance > minDist + 3m，即走过了最近点)，判定已越过该转向点 → 推进。
        // 这样：①低/无精度单帧抖动不会"无声吞掉"转向点(下方 level!=.none 门控+回升判定)；②不会在播"现在转向"前
        // 就推进(推进发生在走过之后)；③不依赖采样恰好命中 5m，避免持续 .beacon 或采样稀疏时永不推进而卡死、
        // 信标长期指回已过转向点(见回归 #1/#2/#4/#5)。.none 精度下 GPS 噪声大，不做几何推进，待精度恢复。
        // .none 精度下 GPS 噪声大，不喂入几何推进判定，待精度恢复（信标此时也已被门控关闭）。
        if level != .none, waypointAdvance.update(distanceMeters: distance) {
            stepIndex += 1
            lastSpoken = ""   // 新转向点：清空去重基线，使下个转向即便文本相同也能播报
        }
    }

    private func planRoute(from loc: CLLocation, gen: Int) async {
        // 仅当本任务仍是最新一代（未被新的 start/stop 作废）时才解除重规划门控（见审查 #1）。
        defer { if gen == navGeneration { replanning = false } }
        switch region {
        case .china:
            do {
                // 高德以 GCJ-02 计算路线：起点须把 GPS(WGS-84) 先纠偏，否则起点偏移致整条路线错位（C1）。
                let gOrigin = ChinaCoord.wgs84ToGcj02(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
                let route = try await amap.walking(originLat: gOrigin.lat,
                                                   originLon: gOrigin.lon,
                                                   destination: destinationQuery)
                guard running, gen == navGeneration else { return } // 已被新导航/停止作废，丢弃旧结果
                let result = route.steps
                steps = result.map { NavStrings.stepListItem($0.instruction, meters: Int($0.distanceMeters ?? 0), lang) }

                // 实时逐向引导（与海外同一引擎）：每步折线首点=转向点；全折线供偏航检测；目的地坐标供到达判定。
                let withLine = result.filter { ($0.polyline?.first?.count ?? 0) >= 2 }
                maneuvers = withLine.compactMap { step in
                    guard let p = step.polyline?.first, p.count >= 2 else { return nil }
                    return (CLLocationCoordinate2D(latitude: p[0], longitude: p[1]), step.instruction)
                }
                var line: [Coordinate] = result.flatMap { ($0.polyline ?? []).compactMap { p in
                    p.count >= 2 ? Coordinate(lat: p[0], lon: p[1]) : nil
                } }
                if let dLat = route.destinationLat, let dLon = route.destinationLon,
                   NavigationService.isValidDestination(CLLocationCoordinate2D(latitude: dLat, longitude: dLon)) {
                    destination = CLLocationCoordinate2D(latitude: dLat, longitude: dLon)
                } else if let last = line.last,
                          NavigationService.isValidDestination(CLLocationCoordinate2D(latitude: last.lat, longitude: last.lon)) {
                    destination = CLLocationCoordinate2D(latitude: last.lat, longitude: last.lon) // 旧后端兜底
                }
                if let dest = destination { line.append(Coordinate(lat: dest.latitude, lon: dest.longitude)) }
                routeCoords = line
                stepIndex = 0
                waypointAdvance.reset()
                offRouteStreak = 0

                if previewing { narratePreview(); return } // 预览：不进实时跟踪，逐步试听
                if let first = result.first {
                    lastResolvedDestination = destinationQuery // 成功取到路线：可入收藏（见 P2 审计）
                    if destination != nil, !maneuvers.isEmpty {
                        cacheCurrentPlan() // 断网降级缓存（#8）
                        status = NavStrings.navStartedStatus(result.count, lang)
                        speak(NavStrings.navStartedSpeak(result.count, first.instruction, lang))
                    } else {
                        // 后端未带折线（旧版本）：退化为静态步骤读出。
                        status = NavStrings.staticRouteStatus(result.count, lang)
                        speak(NavStrings.staticRouteSpeak(result.count, first.instruction, lang))
                    }
                } else {
                    failStatus(NavStrings.noWalkingRoute(lang))
                }
            } catch {
                guard running, gen == navGeneration else { return } // 过期/已停止任务的失败不得覆盖新会话状态（见审查 round5 #1）
                // 区分失败原因，给盲人正确的播报（而非一律"路线获取失败"误导其改地址）：
                // destination_not_found=地址查不到；amap_error/amap_not_configured/nav_unavailable=服务侧问题。
                if case let APIError.server(code) = error {
                    switch code {
                    case "destination_not_found": failStatus(NavStrings.destinationNotFound(lang)) // 地址错，缓存也救不了
                    case "amap_error", "amap_not_configured", "nav_unavailable":
                        if fallbackToCachedRoute(from: loc) { return } // 服务侧问题 → 缓存路线顶上（#8）
                        failStatus(NavStrings.navServiceUnavailable(lang))
                    default:
                        if fallbackToCachedRoute(from: loc) { return }
                        failStatus(NavStrings.chinaRouteFailed(lang))
                    }
                } else {
                    // 非服务端错误 = 网络断/超时——正是离线降级的主场景。
                    if fallbackToCachedRoute(from: loc) { return }
                    failStatus(NavStrings.chinaRouteFailed(lang))
                }
            }
        case .overseas:
            // 重规划时复用已知目的地，不重复 geocode（少一个失败点、避免返回不同坐标，见审查 #2）。
            let dest: CLLocationCoordinate2D
            if let existing = destination {
                dest = existing
            } else if let geocoded = await service.geocode(destinationQuery) {
                guard running, gen == navGeneration else { return }
                dest = geocoded
                destination = geocoded
            } else {
                guard running, gen == navGeneration else { return }
                // 离线时 geocode 必然失败——有缓存则顶上（缓存自带目的地坐标），没有才报"找不到"。
                if fallbackToCachedRoute(from: loc) { return }
                failStatus(NavStrings.destinationNotFound(lang)); return
            }
            let m = await service.walkingManeuvers(from: loc.coordinate, to: dest)
            // 关键：旧目的地的规划任务恢复后不得覆盖正在为新目的地建立的状态（见审查 #1）。
            guard running, gen == navGeneration else { return }
            maneuvers = m
            stepIndex = 0
            waypointAdvance.reset()  // 新路线：重置越过波谷基线（见回归 #1）
            offRouteStreak = 0
            // 路线折线（转向点 + 目的地）用于偏航检测。
            routeCoords = m.map { Coordinate(lat: $0.coordinate.latitude, lon: $0.coordinate.longitude) }
                + [Coordinate(lat: dest.latitude, lon: dest.longitude)]
            if previewing { narratePreview(); return } // 预览：不进实时跟踪，逐步试听
            if m.isEmpty {
                // MapKit 离线/无网时返回空——有缓存则顶上（#8）。
                if fallbackToCachedRoute(from: loc) { return }
                failStatus(NavStrings.noWalkingRoute(lang))
            } else {
                status = NavStrings.navStartedStatus(m.count, lang)
                speak(NavStrings.navStartedStatus(m.count, lang))
                lastResolvedDestination = destinationQuery // 成功建立路线：可入收藏（见 P2 审计）
                cacheCurrentPlan() // 断网降级缓存（#8）
            }
        }
    }

    private func speak(_ text: String) {
        guard text != lastSpoken else { return }
        lastSpoken = text
        // 经共享导航语音通道：避障 obstacle/critical 播报会掐断它（跨通道仲裁，Phase 2 标准）。
        NavVoice.shared.speak(text, rate: FeatureSettings().speechRate)
    }

    /// 绕过去重的强制播报：用于**周期性重报**的告警（如偏航每 6s 重报）——这类告警按设计要反复念，
    /// 而 speak() 的 lastSpoken 去重（防转向指令连播）会把第二次起全部吞掉，只播一次（复审 MED）。
    private func forceSpeak(_ text: String) {
        lastSpoken = text
        NavVoice.shared.speak(text, rate: FeatureSettings().speechRate)
    }

    /// 规划成功后写入本地缓存（断网降级用，Waymap 全离线对标）。坐标按当前地区原样存
    /// （china=GCJ-02、overseas=WGS-84），执行时还原同地区语义（见 CachedPlannedRoute 注释）。
    private func cacheCurrentPlan() {
        guard let dest = destination, !maneuvers.isEmpty else { return }
        let entry = CachedPlannedRoute(
            key: PlannedRouteCacheLogic.normalizeKey(destinationQuery),
            regionRaw: region == .china ? "china" : "overseas",
            maneuvers: maneuvers.map { .init(lat: $0.0.latitude, lon: $0.0.longitude, instruction: $0.1) },
            route: routeCoords,
            destLat: dest.latitude, destLon: dest.longitude,
            savedAtMs: Date().timeIntervalSince1970 * 1000)
        PlannedRouteCacheStore().save(entry)
    }

    /// 断网/服务失败时的降级：同目的地同地区且未过期（14 天）的缓存路线直接顶上。
    /// 成功返回 true（已接管状态与播报）。缓存路线离线执行期间偏航走 RouteRejoin 汇入
    /// （customRouteActive=true）——重规划刚失败过，再试只会反复失败打断引导。
    /// - Parameter loc: 当前定位（用于把起始转向点吸附到最近前方，避免从起点把已上路的用户往回带）。
    private func fallbackToCachedRoute(from loc: CLLocation) -> Bool {
        guard !previewing else { return false } // 预览要最新路线，失败就如实报失败
        guard let e = PlannedRouteCacheStore().find(destination: destinationQuery,
                                                    regionRaw: region == .china ? "china" : "overseas") else { return false }
        maneuvers = e.maneuvers.map { (CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon), $0.instruction) }
        routeCoords = e.route
        destination = CLLocationCoordinate2D(latitude: e.destLat, longitude: e.destLon)
        // 起始转向点吸附到当前位置最近的前方转向点：降级常发生在旅途中途（重规划失败），无条件从
        // stepIndex=0 起会让信标把已在路上的用户一路往回带（复审 MED）。坐标系需匹配缓存条目地区。
        let (clat, clon): (Double, Double) = {
            let c = loc.coordinate
            guard e.regionRaw == "china" else { return (c.latitude, c.longitude) }
            let g = ChinaCoord.wgs84ToGcj02(lat: c.latitude, lon: c.longitude)
            return (g.lat, g.lon)
        }()
        let turnPoints = maneuvers.map { Coordinate(lat: $0.0.latitude, lon: $0.0.longitude) }
        stepIndex = RouteRejoin.rejoinIndex(lat: clat, lon: clon, waypoints: turnPoints, currentIndex: 0) ?? 0
        waypointAdvance.reset()
        offRouteStreak = 0
        customRouteActive = true
        lastResolvedDestination = destinationQuery
        let days = max(0, Int((Date().timeIntervalSince1970 * 1000 - e.savedAtMs) / 86_400_000))
        status = NavStrings.offlineRouteStatus(maneuvers.count, lang)
        lastSpoken = "" // 降级警示必报，绕开去重
        speak(NavStrings.offlineRouteFallbackSpeak(days, lang))
        return true
    }

    /// 设置状态并朗读它（导航失败/前置条件不满足时——盲人看不到屏幕上的 status，必须听到，见 P1 审计）。
    private func failStatus(_ text: String) {
        status = text
        lastSpoken = ""   // 失败提示必报，绕开去重
        speak(text)
    }

    /// 定位权限被拒/受限：停下并朗读"请开启定位"，避免永久卡在"正在定位…"（见 P0 审计）。
    private func handleLocationDenied() {
        running = false
        recordingTrail = false
        previewing = false
        service.stop()
        headTracker.stop()
        spatial.stop()
        failStatus(NavStrings.locationDenied(lang))
    }

    // MARK: 街景预览（出门前虚拟试听整条路线）

    /// 预览路线：正常规划，但**不**进入实时跟踪——拿到路线后停定位，逐步朗读全程。
    func startPreview(destination query: String, region: Region) async {
        await start(destination: query, region: region)
        guard running else { return } // start 内部校验失败(未开导航/空目的地)则不进预览
        previewing = true
        status = NavStrings.planningPreview(lang)
    }

    /// 停止预览（停掉正在念的步骤队列）。
    func stopPreview() {
        previewing = false
        NavVoice.shared.stop()
        if running { stop() }
        status = NavStrings.previewStopped(lang)
    }

    /// 路线就绪后的预览旁白：总长 + 逐步"第N步，指令，前行约X米"（经 NavVoice 排队朗读，可随时停）。
    private func narratePreview() {
        service.stop()
        headTracker.stop()
        running = false
        guard !maneuvers.isEmpty else {
            previewing = false
            status = NavStrings.noPreviewRoute(lang)
            speak(NavStrings.noPreviewRoute(lang))
            return
        }
        var pts = maneuvers.map(\.coordinate)
        if let dest = destination { pts.append(dest) }
        var total = 0.0
        var lines: [String] = []
        for i in 0..<maneuvers.count {
            let cur = maneuvers[i].coordinate
            let nxt = pts[min(i + 1, pts.count - 1)]
            let d = Geo.distanceMeters(fromLat: cur.latitude, fromLon: cur.longitude,
                                       toLat: nxt.latitude, toLon: nxt.longitude)
            total += d
            lines.append(NavStrings.previewStep(i + 1, maneuvers[i].instruction, meters: Int(d.rounded()), lang))
        }
        status = NavStrings.previewingStatus(steps: maneuvers.count, meters: Int(total.rounded()), lang)
        let rate = FeatureSettings().speechRate
        NavVoice.shared.speak(NavStrings.previewStartSpeak(meters: Int(total.rounded()),
                                                           steps: maneuvers.count, lang), rate: rate)
        for l in lines { NavVoice.shared.speak(l, rate: rate) } // AVSpeechSynthesizer 自动排队顺读
        NavVoice.shared.speak(NavStrings.previewEndSpeak(lang), rate: rate)
    }

    // MARK: 面包屑回程（Soundscape 式）

    /// 清除已记路线（持久轨迹存单例，跨会话不灭——给用户主动丢弃旧路线的入口，兼顾隐私）。
    func clearTrail() {
        lang = FeatureSettings().language
        BreadcrumbStore.shared.reset()
        trailCount = 0
        recordingTrail = false
        status = NavStrings.trailCleared(lang)
        speak(status)
    }

    /// 开始记路：行进中每 ≥8m 记一个航点（去抖原地抖动），供之后一键原路返回。
    func startTrailRecording() {
        lang = FeatureSettings().language
        let wasNavigating = running
        if running { stop() } // 与导航互斥（共用定位服务）
        if wasNavigating { speak(NavStrings.navStoppedForNew(lang)) } // 告知"已停止当前导航"，再开始记路（见 P2 审计）
        trail.reset()
        trailCount = 0
        recordingTrail = true
        status = NavStrings.trailRecordingStatus(lang)
        speak(NavStrings.trailStartSpeak(lang))
        service.onLocation = { [weak self] loc in self?.handleTrail(loc) }
        service.onAuthDenied = { [weak self] in self?.handleLocationDenied() }
        service.requestAuthAndStart()
    }

    /// 停止记路（保留已记轨迹，可随时原路返回）。
    func stopTrailRecording() {
        recordingTrail = false
        service.stop()
        status = trailCount >= 2 ? NavStrings.trailStopStatus(trailCount, lang) : NavStrings.trailTooFew(lang)
        speak(status)
    }

    /// 一键原路返回：把轨迹反向作为航点喂给同一套实时引导引擎（信标+转向+到达判定）。
    func startBacktrack() {
        lang = FeatureSettings().language
        guard trail.count >= 2, let origin = trail.start else {
            status = NavStrings.noTrailYet(lang)
            speak(status)
            return
        }
        if recordingTrail { recordingTrail = false }
        let wasNavigating = running
        if running { stop() }
        if wasNavigating { speak(NavStrings.navStoppedForNew(lang)) } // 回程前告知"已停止当前导航"（见 P2 审计）
        navGeneration += 1
        customRouteActive = false
        // 轨迹与 GPS 同为 WGS-84 原始坐标：回程不做 GCJ 纠偏（region 置 overseas 即"不转换"）。
        region = .overseas
        destinationQuery = NavStrings.backtrackDestinationName(lang)
        let waypoints = trail.backtrackWaypoints(minSpacingMeters: 25)
        maneuvers = waypoints.map { (CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon),
                                     NavStrings.backtrackInstruction(lang)) }
        destination = CLLocationCoordinate2D(latitude: origin.lat, longitude: origin.lon)
        routeCoords = waypoints
        stepIndex = 0
        waypointAdvance.reset()
        offRouteStreak = 0
        steps = []
        instruction = ""
        lastSpoken = ""
        headingReliable = false
        headingFilter = HeadingFilter()
        routeReady = true  // 航点已就绪，不走 planRoute
        replanning = false
        running = true
        // callout 时钟基线同 start()：起步让位 + 不在首帧发网络请求。
        lastCallout = ProcessInfo.processInfo.systemUptime
        lastRoadGeocode = ProcessInfo.processInfo.systemUptime
        status = NavStrings.backtrackStatus(waypoints.count, lang)
        speak(NavStrings.backtrackStartSpeak(lang))
        service.onLocation = { [weak self] loc in self?.handle(loc) }
        service.onHeading = { [weak self] h in
            guard let self else { return }
            if self.headingFilter.isReliable(accuracyDegrees: h.headingAccuracy) {
                let raw = h.trueHeading >= 0 ? h.trueHeading : h.magneticHeading
                self.currentHeading = self.headingFilter.update(headingDegrees: raw, accuracyDegrees: h.headingAccuracy)
                self.headingReliable = true
                self.lastHeadingTime = ProcessInfo.processInfo.systemUptime
            } else {
                self.headingReliable = false
            }
        }
        headTracker.onYaw = { [weak self] yaw in self?.spatial.setListenerYaw(Float(yaw)) }
        headTracker.onUnavailable = { [weak self] in self?.spatial.setListenerYaw(0) }
        headTracker.start()
        service.onAuthDenied = { [weak self] in self?.handleLocationDenied() }
        service.requestAuthAndStart()
    }

    /// 自定义路线的共享初始化（执行与预览共用）：门控 + 停旧会话 + 铺设 maneuvers/destination/routeCoords。
    /// 返回 false 表示门控未过（已播报原因），调用方不应继续。
    private func setupCustomRoute(name: String, waypoints: [(lat: Double, lon: Double, note: String?)]) -> Bool {
        lang = FeatureSettings().language
        // 与 start() 同门控：导航功能被关时点路线须听到原因，不静默什么都不发生（复审 MED）。
        guard FeatureSettings().navigationEnabled else { failStatus(NavStrings.enableFirst(lang)); return false }
        guard waypoints.count >= 2 else { return false } // 服务端已保证 >=2；纵深防御
        let wasNavigating = running || previewing
        if running { stop() }
        if previewing { stopPreview() } // 预览态残留会让旁白与路线引导叠读、按钮错标"停止预览"（复审 MED）
        if wasNavigating { speak(NavStrings.navStoppedForNew(lang)) }
        navGeneration += 1
        customRouteActive = true
        previewing = false
        region = .overseas // WGS-84 原始坐标：绝不过 GCJ 纠偏分支（全栈坐标约定）
        destinationQuery = name
        maneuvers = waypoints.map { (CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon),
                                     ($0.note?.isEmpty == false) ? $0.note! : NavStrings.customRouteInstruction(lang)) }
        destination = CLLocationCoordinate2D(latitude: waypoints[waypoints.count - 1].lat,
                                             longitude: waypoints[waypoints.count - 1].lon)
        routeCoords = waypoints.map { Coordinate(lat: $0.lat, lon: $0.lon) }
        stepIndex = 0
        waypointAdvance.reset()
        offRouteStreak = 0
        steps = []
        instruction = ""
        lastSpoken = ""
        headingReliable = false
        headingFilter = HeadingFilter()
        routeReady = true  // 航点已就绪，不走 planRoute
        replanning = false
        return true
    }

    /// 出发前预览一条自定义路线（Soundscape 街景预览对齐）：不进实时跟踪，逐点试听"总长 + 每段方向距离"。
    /// 盲人在家先听清路线全貌再决定是否走——与规划路线的预览（startPreview→narratePreview）同一套旁白。
    func previewCustomRoute(name: String, waypoints: [(lat: Double, lon: Double, note: String?)]) {
        guard setupCustomRoute(name: name, waypoints: waypoints) else { return }
        previewing = true
        status = NavStrings.planningPreview(lang)
        narratePreview() // 内部 service.stop()+running=false，逐步排队朗读，可随时 stopPreview
    }

    /// 执行路线库中的一条自定义路线（亲友编排/自存，Soundscape Guided Routes 式）：
    /// 服务端下发的 WGS-84 航点直接喂给同一套实时引导引擎（照抄 startBacktrack 模板——
    /// region=.overseas 即"不做 GCJ 纠偏"，与面包屑回程同约定；引导内核零改动）。
    func startCustomRoute(name: String, waypoints: [(lat: Double, lon: Double, note: String?)]) {
        guard setupCustomRoute(name: name, waypoints: waypoints) else { return }
        running = true
        lastCallout = ProcessInfo.processInfo.systemUptime
        lastRoadGeocode = ProcessInfo.processInfo.systemUptime
        status = NavStrings.customRouteStatus(name, waypoints.count, lang)
        speak(NavStrings.customRouteStartSpeak(name, lang))
        service.onLocation = { [weak self] loc in self?.handle(loc) }
        service.onHeading = { [weak self] h in
            guard let self else { return }
            if self.headingFilter.isReliable(accuracyDegrees: h.headingAccuracy) {
                let raw = h.trueHeading >= 0 ? h.trueHeading : h.magneticHeading
                self.currentHeading = self.headingFilter.update(headingDegrees: raw, accuracyDegrees: h.headingAccuracy)
                self.headingReliable = true
                self.lastHeadingTime = ProcessInfo.processInfo.systemUptime
            } else {
                self.headingReliable = false
            }
        }
        headTracker.onYaw = { [weak self] yaw in self?.spatial.setListenerYaw(Float(yaw)) }
        headTracker.onUnavailable = { [weak self] in self?.spatial.setListenerYaw(0) }
        headTracker.start()
        service.onAuthDenied = { [weak self] in self?.handleLocationDenied() }
        service.requestAuthAndStart()
    }

    /// 记路：精度可信(≤30m)才入轨，去抖在核心 BreadcrumbTrail 内（≥8m）。
    private func handleTrail(_ loc: CLLocation) {
        guard recordingTrail else { return }
        guard loc.horizontalAccuracy > 0, loc.horizontalAccuracy <= 30 else { return }
        if trail.record(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude) {
            trailCount = trail.count
            status = NavStrings.trailProgress(trailCount, lang)
        }
    }

    /// 沿途地标 callout：查最近 POI，60m 内且与上次不同才报"途经 X"（参考 Soundscape）。
    private func announceNearbyLandmark(at loc: CLLocation) {
        let request = MKLocalPointsOfInterestRequest(center: loc.coordinate, radius: 80)
        MKLocalSearch(request: request).start { [weak self] response, _ in
            let items = response?.mapItems ?? []
            Task { @MainActor in
                guard let self else { return }
                self.calloutBusy = false
                guard self.running else { return }
                guard let item = items.first(where: { ($0.name ?? "").isEmpty == false && $0.name != self.lastCalloutName }),
                      let name = item.name, let ploc = item.placemark.location,
                      loc.distance(from: ploc) <= 60 else { return }
                self.lastCalloutName = name
                NavVoice.shared.speakCallout(NavStrings.passingBy(name, self.lang)) // 信息性：让位于转向指令，繁忙时丢弃
            }
        }
    }

    /// 路名变化 callout：反向地理编码取当前路名，确实变了才报"进入 X"（核心 RoadAnnouncer，已测）。
    /// 传给 CLGeocoder 的是原始 WGS-84 定位（系统内部自行处理国内地名展示），不经 GCJ 纠偏。
    private func announceRoadChange(at loc: CLLocation, now: TimeInterval) {
        roadGeocoder.reverseGeocodeLocation(loc, preferredLocale: NavStrings.geocodeLocale(lang)) { [weak self] placemarks, _ in
            Task { @MainActor in
                guard let self else { return }
                self.roadGeocodeBusy = false
                guard self.running else { return }
                let road = placemarks?.first?.thoroughfare
                if let name = self.roadAnnouncer.update(road: road, now: now) {
                    NavVoice.shared.speakCallout(NavStrings.enteringRoad(name, self.lang)) // 信息性：让位于转向指令
                }
            }
        }
    }
}
