import Foundation
import Observation
import AVFoundation
import CoreLocation

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
    @ObservationIgnored private let synthesizer = AVSpeechSynthesizer()
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
    @ObservationIgnored private var announcedImminent = false           // 当前转向点的"现在…"高确定性指令是否已播——推进的前提（见审查 #7）
    @ObservationIgnored private var offRouteStreak = 0                  // 连续判定偏航的帧数，需≥2 抗单帧抖动（见审查 #3）

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
        announcedImminent = false
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
        guard region == .overseas, let dest = destination else { return }
        let now = ProcessInfo.processInfo.systemUptime // 单调时钟，避免系统时间回拨冻结信标/偏航节流（见审查 #6）
        let lat = loc.coordinate.latitude, lon = loc.coordinate.longitude
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
            spatial.playCue(azimuthDegrees: Float(beacon.relativeAzimuthDegrees))
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
            if decision.isHighCertainty { announcedImminent = true } // 记录"现在…"已播，作为安全推进的前提
        }
        // 步进推进必须同时满足：(a) 高精度(level==.precise)，(b) 该转向点的"现在…"高确定性指令**已经播报**，
        // (c) 已进入即将窗口(distance < imminentMeters)。否则：
        // - 低精度单帧 GPS 抖动会无声吞掉转向点(漏播"过马路/转向"，对盲人是直接危险，见审查 #1/#8)；
        // - 旧的 8m 推进阈值 > 5m 即将阈值，会在播"现在转向"之前就推进，导致该关键指令永不播报（见审查 #7）。
        if level == .precise, announcedImminent, distance < progress.imminentMeters {
            stepIndex += 1
            announcedImminent = false
            lastSpoken = ""   // 新转向点：清空去重基线，使下个转向即便文本相同也能播报
        }
    }

    private func planRoute(from loc: CLLocation, gen: Int) async {
        // 仅当本任务仍是最新一代（未被新的 start/stop 作废）时才解除重规划门控（见审查 #1）。
        defer { if gen == navGeneration { replanning = false } }
        switch region {
        case .china:
            do {
                let result = try await amap.walking(originLat: loc.coordinate.latitude,
                                                    originLon: loc.coordinate.longitude,
                                                    destination: destinationQuery)
                guard running, gen == navGeneration else { return } // 已被新导航/停止作废，丢弃旧结果
                steps = result.map { "\($0.instruction)（\(Int($0.distanceMeters ?? 0)) 米）" }
                if let first = result.first {
                    status = "共 \(result.count) 步"
                    speak("共\(result.count)步。第一步：\(first.instruction)")
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
            announcedImminent = false   // 新路线：重置"现在…已播"标志，避免沿用旧步的状态（见审查 #7）
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
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        utterance.rate = AVSpeechUtteranceMinimumSpeechRate
            + (AVSpeechUtteranceMaximumSpeechRate - AVSpeechUtteranceMinimumSpeechRate) * FeatureSettings().speechRate
        synthesizer.speak(utterance)
    }
}
