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
    // 计算属性按需读取：本类是 static let 单例（跨语言切换长期存活），不能在 init 缓存 lang，
    // 否则运行时切换语言后位置共享的语音播报仍停留在旧语言（与 EmergencyWatch/VoiceCommandListener 同模式）。
    private var lang: Language { FeatureSettings().language }
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
    // 最近一次在途上报：stopSharing 发 stop 前先 await 它落地，保证 update→stop 的到达顺序。
    // 否则已过 sharing 守卫、悬在 await updateLocation 的旧上报若晚于 stop 到达服务器，
    // 会把刚停止的共享"复活"（服务端 update 无条件 set、stop 只 delete）≤90s（见 flag task_86ec92b0）。
    @ObservationIgnored private var inflightPublish: Task<Void, Never>?
    // 到达围栏自播报（"你到家了"）：共享期间本地判定盲人自己到达常用地点，做定向确认（服务端另通知家人）。
    @ObservationIgnored private var geofencePlaces: [APIClient.SavedPlace] = []
    @ObservationIgnored private var geofenceInside: Set<String>? = nil // nil=基线未建（首帧只建基线不报，免"开始共享时已在家"误报）

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
                await self?.trackedPublish()
                try? await Task.sleep(for: .seconds(10))
            }
        }
        announce(LiveLocationStrings.startedSpeak(lang))
        // 加载常用地点坐标供到达围栏（"你到家了"自播报）；重置滞回基线，首帧只建基线不报。
        geofenceInside = nil
        if let token { Task { [weak self] in self?.geofencePlaces = (try? await APIClient().savedPlaces(token: token)) ?? [] } }
    }

    func stopSharing() {
        guard sharing else { return }
        sharing = false
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        publishTask?.cancel(); publishTask = nil
        geofencePlaces = []; geofenceInside = nil // 停止共享即清围栏状态（下次开始重载+重建基线）
        clearCachedFix() // 停止后清缓存定位：再次开始共享前不复用旧坐标上报（见复审）
        // 先等在途上报落地再发 stop：保证服务器按 update→stop 顺序处理，杜绝晚到的旧上报复活已停共享。
        // 在途请求受 30s 空闲超时约束，最坏也只延迟 stop 半分钟；本地 sharing 已置 false，UI/播报即时。
        if let token {
            let pending = inflightPublish
            Task {
                await pending?.value
                try? await APIClient().stopSharingLocation(token: token)
            }
        }
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
        checkGeofenceArrival(loc)
        // 移动达阈值即可立即上报（不必等定时器），让对端更跟手——但不超过每 ~6s 一次，省流量/限流。
        if Date().timeIntervalSince(lastPublish) >= 6 { Task { await trackedPublish() } }
    }

    /// 本地到达围栏判定并播报"你到家了"（核心 GeofenceEvaluator，已测；与服务端同滞回门槛）。只播**到达**（定向确认，
    /// 离开对定向意义小、免噪声）。首帧只建基线不报（避免开始共享时已在某地点却误报"你到了"）。
    private func checkGeofenceArrival(_ loc: CLLocation) {
        guard !geofencePlaces.isEmpty else { return }
        let places = geofencePlaces.compactMap { p -> GeofenceEvaluator.Place? in
            guard let lat = p.lat, let lng = p.lng else { return nil }
            return GeofenceEvaluator.Place(label: p.label, lat: lat, lng: lng)
        }
        let result = GeofenceEvaluator.evaluate(currentLat: loc.coordinate.latitude, currentLon: loc.coordinate.longitude,
                                                places: places, prevInside: geofenceInside ?? [])
        if geofenceInside != nil { // 已建基线：播本次新到达
            for label in result.arrived { announce(LiveLocationStrings.arrivedAtPlace(label, lang)) }
        }
        geofenceInside = result.insideLabels
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { /* 瞬时失败忽略，下次更新/定时器重试 */ }

    // MARK: 网络

    /// 以可追踪的独立 Task 执行一次上报并等其完成：把在途上报登记到 inflightPublish，
    /// 使 stopSharing 能 await 它落地后再发 stop（顺序保证）；独立 Task 也让 publishTask.cancel()
    /// 不会把已在途的 POST 一并取消（保持既有"发出的上报总会完成"语义）。
    private func trackedPublish() async {
        let t = Task { await self.publishLatest() }
        inflightPublish = t
        await t.value
    }

    private func publishLatest() async {
        guard sharing, let token, let loc = latest else { return }
        // 纵深防御：绝不上报陈旧定位（>30s 视为过期，等新一次 didUpdateLocations）——
        // 即便缓存清理被绕过，也不会把旧/他人定位发出去（见复审 HIGH）。
        guard Date().timeIntervalSince(loc.timestamp) < 30 else { return }
        lastPublish = Date()
        let course = loc.course >= 0 ? loc.course : nil
        let acc = loc.horizontalAccuracy >= 0 ? loc.horizontalAccuracy : nil
        // 随位置附上电量%（Find My/Life360 惯例）：亲友看到"快没电"可在盲人失联前主动联系。未知(-1)不带。
        UIDevice.current.isBatteryMonitoringEnabled = true
        let lvl = UIDevice.current.batteryLevel
        let battery = lvl >= 0 ? Int((lvl * 100).rounded()) : nil
        if let until = try? await APIClient().updateLocation(token: token, lat: loc.coordinate.latitude, lng: loc.coordinate.longitude, accuracy: acc, heading: course, battery: battery) {
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
