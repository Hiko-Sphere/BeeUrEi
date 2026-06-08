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
    @ObservationIgnored private var lastSpoken = ""

    @ObservationIgnored private var routeCoords: [Coordinate] = []
    @ObservationIgnored private var currentHeading: Double = 0
    @ObservationIgnored private var lastBeacon: TimeInterval = 0
    @ObservationIgnored private var lastOffRouteAnnounce: TimeInterval = 0

    func start(destination query: String, region: Region) async {
        guard FeatureSettings().navigationEnabled else {
            status = "请先在「设置 → 功能」开启步行导航"
            return
        }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { status = "请输入目的地"; return }

        self.region = region
        self.destinationQuery = trimmed
        routeReady = false
        stepIndex = 0
        steps = []
        instruction = ""
        routeCoords = []
        running = true
        status = "正在定位…"

        service.onLocation = { [weak self] loc in self?.handle(loc) }
        service.onHeading = { [weak self] h in
            self?.currentHeading = h.trueHeading >= 0 ? h.trueHeading : h.magneticHeading
        }
        // AirPods 头追踪驱动空间音听者朝向，使信标保持世界固定（无耳机自动跳过）。
        headTracker.onYaw = { [weak self] yaw in self?.spatial.setListenerYaw(Float(yaw)) }
        headTracker.start()
        service.requestAuthAndStart()
    }

    func stop() {
        running = false
        service.stop()
        headTracker.stop()
        status = "导航已停止"
    }

    private func handle(_ loc: CLLocation) {
        guard running else { return }

        if !routeReady {
            routeReady = true
            Task { await planRoute(from: loc) }
            return
        }

        // 仅海外做实时引导（国内为静态步骤读出）。
        guard region == .overseas, let dest = destination else { return }
        let now = Date().timeIntervalSince1970
        let lat = loc.coordinate.latitude, lon = loc.coordinate.longitude

        // 偏航检测 → 重新规划（核心 OffRouteDetector，已测）。
        if !routeCoords.isEmpty, offRoute.isOffRoute(lat: lat, lon: lon, route: routeCoords),
           now - lastOffRouteAnnounce >= 6 {
            lastOffRouteAnnounce = now
            instruction = "已偏离路线，正在重新规划"
            speak("已偏离路线，正在重新规划")
            routeReady = false   // 下次定位触发重规划
            return
        }

        // 目标点：当前转向点，过完则朝目的地。
        let target = stepIndex < maneuvers.count ? maneuvers[stepIndex].coordinate : dest

        // 空间音信标：把提示音"挂"在目标方位（核心 Geo + BeaconDirection，已测），约每 1.5s 一响。
        if now - lastBeacon >= 1.5 {
            lastBeacon = now
            let bearing = Geo.initialBearing(fromLat: lat, fromLon: lon, toLat: target.latitude, toLon: target.longitude)
            let beacon = BeaconDirection(headingDegrees: currentHeading, bearingDegrees: bearing)
            spatial.playCue(azimuthDegrees: Float(beacon.relativeAzimuthDegrees))
        }

        // 已过完所有转向点：接近目的地判定。
        guard stepIndex < maneuvers.count else {
            let toDest = Geo.distanceMeters(fromLat: lat, fromLon: lon, toLat: dest.latitude, toLon: dest.longitude)
            if toDest < 15 { status = "已接近目的地"; speak("已接近目的地"); stop() }
            return
        }

        // 转向播报（精度门控，核心 RouteProgress，已测）。
        let level = gate.level(horizontalAccuracyMeters: loc.horizontalAccuracy)
        let next = maneuvers[stepIndex]
        let distance = Geo.distanceMeters(fromLat: lat, fromLon: lon, toLat: next.coordinate.latitude, toLon: next.coordinate.longitude)
        let decision = progress.decide(distanceToManeuverMeters: distance, instruction: next.instruction, level: level)
        if decision.shouldAnnounce, let text = decision.text {
            instruction = text
            speak(text)
        }
        if distance < 8 { stepIndex += 1 }
    }

    private func planRoute(from loc: CLLocation) async {
        switch region {
        case .china:
            do {
                let result = try await amap.walking(originLat: loc.coordinate.latitude,
                                                    originLon: loc.coordinate.longitude,
                                                    destination: destinationQuery)
                steps = result.map { "\($0.instruction)（\(Int($0.distanceMeters)) 米）" }
                if let first = result.first {
                    status = "共 \(result.count) 步"
                    speak("共\(result.count)步。第一步：\(first.instruction)")
                } else {
                    status = "未找到步行路线"
                }
            } catch {
                status = "国内路线获取失败（需登录并连接后端）"
            }
        case .overseas:
            guard let dest = await service.geocode(destinationQuery) else { status = "找不到目的地"; return }
            destination = dest
            let m = await service.walkingManeuvers(from: loc.coordinate, to: dest)
            maneuvers = m
            stepIndex = 0
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
