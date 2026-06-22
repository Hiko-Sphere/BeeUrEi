import Foundation
import Observation
import CoreLocation
import UIKit

/// 实时位置共享管理器：开启后周期把本机位置上报到后端（亲友/协助者可见），并轮询联系人当前位置。
/// 隐私优先：仅在用户**显式开启**时采集与上报；停止/离开后端记录立即清除（服务端纯内存，不留轨迹）。
/// 盲人侧的开关与状态变化经 SpeechHub 语音播报（未开 VoiceOver 也能听到）。
@MainActor
@Observable
final class LiveLocationManager: NSObject, CLLocationManagerDelegate {
    /// 单例：使共享在切换界面/进入后台后仍持续（口袋熄屏可继续共享），直到用户显式停止或退出登录。
    static let shared = LiveLocationManager()

    private let manager = CLLocationManager()
    private let lang = FeatureSettings().language
    @ObservationIgnored private var isBlind = false   // 盲人侧用 SpeechHub 朗读状态；协助者/亲友走系统无障碍公告即可

    private(set) var sharing = false
    private(set) var authorizationDenied = false
    private(set) var lastCoordinate: CLLocationCoordinate2D?
    private(set) var contacts: [ContactLocationInfo] = []
    private(set) var sharingUntil: Double = 0

    @ObservationIgnored private var token: String?
    @ObservationIgnored private var latest: CLLocation?
    @ObservationIgnored private var publishTask: Task<Void, Never>?
    @ObservationIgnored private var pollTask: Task<Void, Never>?
    @ObservationIgnored private var lastPublish: Date = .distantPast

    private override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 8 // 走动 ≥8m 才回调，省电；静止由发布定时器维持共享
    }

    /// 登出时调用：停止共享与轮询，清空联系人**及缓存定位**，避免跨账号泄漏
    /// （否则单例残留的上一账号 GPS 会在下一账号开始共享时被立即上报，见复审 HIGH）。
    func reset() {
        stopSharing()
        stopViewing()
        contacts = []
        token = nil
        clearCachedFix()
    }

    /// 清空缓存定位（换账号/停止共享后，绝不复用旧定位上报或计算距离）。
    private func clearCachedFix() {
        latest = nil
        lastCoordinate = nil
        lastPublish = .distantPast
        sharingUntil = 0
    }

    // MARK: 查看（进入界面即轮询联系人位置；与是否共享自身无关）

    func startViewing(token: String, isBlind: Bool) {
        self.token = token
        self.isBlind = isBlind
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.pollContacts()
                try? await Task.sleep(for: .seconds(8))
            }
        }
    }

    /// 离开界面：停止轮询联系人。**不**自动停止共享——用户可能希望放进口袋继续共享（后台）。
    func stopViewing() {
        pollTask?.cancel(); pollTask = nil
    }

    // MARK: 共享自身位置

    func toggleSharing() { sharing ? stopSharing() : startSharing() }

    func startSharing() {
        guard !sharing else { return }
        let status = manager.authorizationStatus
        guard status != .denied, status != .restricted else { authorizationDenied = true; announce(LiveLocationStrings.permissionDenied(lang)); return }
        sharing = true
        authorizationDenied = false
        // 后台续传：开启后台定位更新（需 Info.plist UIBackgroundModes 含 location），口袋里熄屏仍可共享。
        manager.allowsBackgroundLocationUpdates = true
        manager.pausesLocationUpdatesAutomatically = false
        if status == .notDetermined {
            manager.requestWhenInUseAuthorization() // 授权结果在 didChangeAuthorization 里再启动更新
        } else {
            manager.startUpdatingLocation()
        }
        // 发布定时器：每 10s 把最近一次定位上报，静止时也维持共享有效期。
        publishTask?.cancel()
        publishTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.publishLatest()
                try? await Task.sleep(for: .seconds(10))
            }
        }
        announce(LiveLocationStrings.startedSpeak(lang))
    }

    func stopSharing() {
        guard sharing else { return }
        sharing = false
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        publishTask?.cancel(); publishTask = nil
        clearCachedFix() // 停止后清缓存定位：再次开始共享前不复用旧坐标上报（见复审）
        if let token { Task { try? await APIClient().stopSharingLocation(token: token) } }
        announce(LiveLocationStrings.stoppedSpeak(lang))
    }

    // MARK: CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            if sharing { manager.startUpdatingLocation() }
        case .denied, .restricted:
            authorizationDenied = true
            if sharing { stopSharing() }
            announce(LiveLocationStrings.permissionDenied(lang))
        default: break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        latest = loc
        lastCoordinate = loc.coordinate
        // 移动达阈值即可立即上报（不必等定时器），让对端更跟手——但不超过每 ~6s 一次，省流量/限流。
        if Date().timeIntervalSince(lastPublish) >= 6 { Task { await publishLatest() } }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { /* 瞬时失败忽略，下次更新/定时器重试 */ }

    // MARK: 网络

    private func publishLatest() async {
        guard sharing, let token, let loc = latest else { return }
        // 纵深防御：绝不上报陈旧定位（>30s 视为过期，等新一次 didUpdateLocations）——
        // 即便缓存清理被绕过，也不会把旧/他人定位发出去（见复审 HIGH）。
        guard Date().timeIntervalSince(loc.timestamp) < 30 else { return }
        lastPublish = Date()
        let course = loc.course >= 0 ? loc.course : nil
        let acc = loc.horizontalAccuracy >= 0 ? loc.horizontalAccuracy : nil
        if let until = try? await APIClient().updateLocation(token: token, lat: loc.coordinate.latitude, lng: loc.coordinate.longitude, accuracy: acc, heading: course) {
            sharingUntil = until
        }
    }

    private func pollContacts() async {
        guard let token else { return }
        do {
            let r = try await APIClient().contactLocations(token: token)
            contacts = r.contacts
            // 与服务端真相对齐（如本机被管理员/TTL 下线，UI 同步）。
            if !sharing { sharingUntil = r.sharingUntil }
        } catch { /* 网络抖动忽略 */ }
    }

    // MARK: 语音

    private func announce(_ text: String) {
        A11y.announce(text)
        if isBlind, !UIAccessibility.isVoiceOverRunning {
            SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode)
        }
    }
}
