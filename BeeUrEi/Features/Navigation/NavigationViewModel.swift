import Foundation
import Observation
import AVFoundation
import CoreLocation

/// 步行导航视图模型。海外用 MapKit（实时转向播报，接已测核心）；国内用高德（经后端，
/// key 在 .env）取步行路线并读出步骤。
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

    @ObservationIgnored private var region: Region = .overseas
    @ObservationIgnored private var destinationQuery = ""
    @ObservationIgnored private var maneuvers: [(coordinate: CLLocationCoordinate2D, instruction: String)] = []
    @ObservationIgnored private var stepIndex = 0
    @ObservationIgnored private var destination: CLLocationCoordinate2D?
    @ObservationIgnored private var routeReady = false
    @ObservationIgnored private var lastSpoken = ""

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
        running = true
        status = "正在定位…"
        service.onLocation = { [weak self] loc in self?.handle(loc) }
        service.requestAuthAndStart()
    }

    func stop() {
        running = false
        service.stop()
        status = "导航已停止"
    }

    private func handle(_ loc: CLLocation) {
        guard running else { return }

        // 首次定位后规划路线。
        if !routeReady {
            routeReady = true
            Task { await planRoute(from: loc) }
            return
        }

        // 仅海外做实时转向推进（国内为静态步骤读出）。
        guard region == .overseas, let dest = destination else { return }

        guard stepIndex < maneuvers.count else {
            let toDest = Geo.distanceMeters(fromLat: loc.coordinate.latitude, fromLon: loc.coordinate.longitude,
                                            toLat: dest.latitude, toLon: dest.longitude)
            if toDest < 15 { status = "已接近目的地"; speak("已接近目的地"); stop() }
            return
        }

        let level = gate.level(horizontalAccuracyMeters: loc.horizontalAccuracy)
        let next = maneuvers[stepIndex]
        let distance = Geo.distanceMeters(fromLat: loc.coordinate.latitude, fromLon: loc.coordinate.longitude,
                                          toLat: next.coordinate.latitude, toLon: next.coordinate.longitude)
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
            status = m.isEmpty ? "未找到步行路线" : "导航开始，共 \(m.count) 步"
        }
    }

    private func speak(_ text: String) {
        guard text != lastSpoken else { return }
        lastSpoken = text
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        synthesizer.speak(utterance)
    }
}
