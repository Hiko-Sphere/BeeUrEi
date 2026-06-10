import Foundation
import Observation
import AVFoundation
import CoreLocation
import MapKit

/// 步行导航视图模型。海外用 MapKit（实时转向播报 + **空间音信标** + **偏航重规划** +
/// **AirPods 头追踪**，接已测核心）；国内用高德（经后端，key 在 .env）取步行路线并读出步骤。
@MainActor
@Observable
final class NavigationViewModel {
    enum Region { case overseas, china }

    private(set) var status = "输入目的地后开始导航"
    private(set) var instruction = ""
    private(set) var steps: [String] = []     // 国内：路线步骤列表（VoiceOver 可读）
    private(set) var running = false

    @ObservationIgnored private let service = NavigationService()
    @ObservationIgnored private let amap = AMapRouteClient()
    @ObservationIgnored private let progress = RouteProgress()
    @ObservationIgnored private let gate = LocationAccuracyGate()
    @ObservationIgnored private let spatial = SpatialAudioFeedback()
    @ObservationIgnored private let headTracker = HeadTracker()
    @ObservationIgnored private let offRoute = OffRouteDetector()

    @ObservationIgnored private var region: Region = .overseas
    @ObservationIgnored private var destinationQuery = ""
    @ObservationIgnored private var maneuvers: [(coordinate: CLLocationCoordinate2D, instruction: String)] = []
    @ObservationIgnored private var stepIndex = 0
    @ObservationIgnored private var destination: CLLocationCoordinate2D?
    @ObservationIgnored private var routeReady = false
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

    func start(destination query: String, region: Region) async {
        guard FeatureSettings().navigationEnabled else {
            status = "请先在「设置 → 功能」开启步行导航"
            return
        }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { status = "请输入目的地"; return }

        // 重入保护：导航中再次 start(如点了常用目的地)先彻底停止旧导航，避免新旧目的地状态混合（见审查 #5）。
        if running { stop() }
        navGeneration += 1   // 作废任何仍挂在 await 上的旧规划任务（见审查 #1）

        self.region = region
        self.destinationQuery = trimmed
        routeReady = false
        replanning = false
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
        status = "正在定位…"

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
        status = "导航已停止"
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
            instruction = "已偏离路线，正在重新规划"
            speak("已偏离路线，正在重新规划")
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

        // 已过完所有转向点：接近目的地判定。**到达=高确定性结论，也要过精度门控**——
        // 否则低精度下单帧 GPS 抖到 15m 内就会误报到达并永久停止导航（见审查 #1）。
        guard stepIndex < maneuvers.count else {
            let toDest = Geo.distanceMeters(fromLat: lat, fromLon: lon, toLat: dest.latitude, toLon: dest.longitude)
            if toDest < 15 {
                if level == .precise {
                    status = "已接近目的地"; speak("已接近目的地"); stop()
                } else {
                    status = "正在接近目的地"   // 精度不足：不轻易宣布到达并终止
                }
            }
            return
        }

        // 转向播报（精度门控，核心 RouteProgress，已测）。
        let next = maneuvers[stepIndex]
        let distance = Geo.distanceMeters(fromLat: lat, fromLon: lon, toLat: next.coordinate.latitude, toLon: next.coordinate.longitude)
        let decision = progress.decide(distanceToManeuverMeters: distance, instruction: next.instruction, level: level)
        if decision.shouldAnnounce, let text = decision.text {
            instruction = text
            speak(text)
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
                steps = result.map { "\($0.instruction)（\(Int($0.distanceMeters ?? 0)) 米）" }

                // 实时逐向引导（与海外同一引擎）：每步折线首点=转向点；全折线供偏航检测；目的地坐标供到达判定。
                let withLine = result.filter { ($0.polyline?.first?.count ?? 0) >= 2 }
                maneuvers = withLine.compactMap { step in
                    guard let p = step.polyline?.first, p.count >= 2 else { return nil }
                    return (CLLocationCoordinate2D(latitude: p[0], longitude: p[1]), step.instruction)
                }
                var line: [Coordinate] = result.flatMap { ($0.polyline ?? []).compactMap { p in
                    p.count >= 2 ? Coordinate(lat: p[0], lon: p[1]) : nil
                } }
                if let dLat = route.destinationLat, let dLon = route.destinationLon {
                    destination = CLLocationCoordinate2D(latitude: dLat, longitude: dLon)
                } else if let last = line.last {
                    destination = CLLocationCoordinate2D(latitude: last.lat, longitude: last.lon) // 旧后端兜底
                }
                if let dest = destination { line.append(Coordinate(lat: dest.latitude, lon: dest.longitude)) }
                routeCoords = line
                stepIndex = 0
                waypointAdvance.reset()
                offRouteStreak = 0

                if let first = result.first {
                    if destination != nil, !maneuvers.isEmpty {
                        status = "导航开始，共 \(result.count) 步"
                        speak("导航开始，共\(result.count)步。\(first.instruction)")
                    } else {
                        // 后端未带折线（旧版本）：退化为静态步骤读出。
                        status = "共 \(result.count) 步（静态路线）"
                        speak("共\(result.count)步。第一步：\(first.instruction)")
                    }
                } else {
                    status = "未找到步行路线"
                }
            } catch {
                guard running, gen == navGeneration else { return } // 过期/已停止任务的失败不得覆盖新会话状态（见审查 round5 #1）
                status = "国内路线获取失败（需登录并连接后端）"
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
                status = "找不到目的地"; return
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
            status = m.isEmpty ? "未找到步行路线" : "导航开始，共 \(m.count) 步"
        }
    }

    private func speak(_ text: String) {
        guard text != lastSpoken else { return }
        lastSpoken = text
        // 经共享导航语音通道：避障 obstacle/critical 播报会掐断它（跨通道仲裁，Phase 2 标准）。
        NavVoice.shared.speak(text, rate: FeatureSettings().speechRate)
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
                NavVoice.shared.speak("途经\(name)", rate: FeatureSettings().speechRate)
            }
        }
    }
}
