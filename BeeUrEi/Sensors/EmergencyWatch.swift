import Foundation
import CoreMotion
import CoreLocation
import SwiftUI

/// 摔倒/剧烈撞击监测（加速度计 20Hz → 核心 FallDetector 状态机，已测）。
/// 主页运行期间持续监测（手机在口袋/手中行走是主要场景）。
final class MotionMonitor {
    private let motion = CMMotionManager()
    private var detector = FallDetector()
    private let queue = OperationQueue()

    func start(onEvent: @escaping (FallDetector.Event) -> Void) {
        guard motion.isAccelerometerAvailable, !motion.isAccelerometerActive else { return }
        motion.accelerometerUpdateInterval = 0.05 // 20Hz：足够捕捉失重/撞击，省电
        motion.startAccelerometerUpdates(to: queue) { [weak self] data, _ in
            guard let self, let a = data?.acceleration else { return }
            let magnitude = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
            let event = self.detector.ingest(magnitude: magnitude, at: data!.timestamp)
            if event != .none {
                DispatchQueue.main.async { onEvent(event) }
            }
        }
    }

    func stop() {
        motion.stopAccelerometerUpdates()
        detector.reset()
    }
}

/// 紧急警报中心：检测到疑似摔倒/车祸 → 30s 倒计时（语音+全屏警报卡，可取消）→
/// 无人取消则通知所有 accepted 绑定亲友（后端推送，附最近位置）。
/// 语音全部走总线 .call 通道（最高非避障级）：不与避障/导航/识别播报重叠。
@MainActor
@Observable
final class EmergencyAlertCenter: NSObject, CLLocationManagerDelegate {
    static let shared = EmergencyAlertCenter()

    enum Phase: Equatable { case idle, countdown(kind: String, secondsLeft: Int), sending, sent(notified: Int), failed }
    private(set) var phase: Phase = .idle

    @ObservationIgnored private var countdownTask: Task<Void, Never>?
    @ObservationIgnored private let location = CLLocationManager()
    @ObservationIgnored private var lastFix: CLLocation?
    private var lang: Language { FeatureSettings().language }

    private override init() {
        super.init()
        location.delegate = self
        location.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    /// 触发警报流程（已有警报进行中时忽略，防连环触发刷屏）。
    func trigger(_ event: FallDetector.Event) {
        guard phase == .idle, event != .none else { return }
        let kind = event == .suspectedCrash ? "crash" : "fall"
        phase = .countdown(kind: kind, secondsLeft: 30)
        location.requestWhenInUseAuthorization()
        location.requestLocation() // 提前定位，发送时带上
        speak(HomeStrings.fallAlertSpeak(kind: kind, lang))
        countdownTask = Task { [weak self] in
            for remaining in stride(from: 29, through: 0, by: -1) {
                try? await Task.sleep(for: .seconds(1))
                guard let self, !Task.isCancelled else { return }
                guard case .countdown(let k, _) = self.phase else { return }
                self.phase = .countdown(kind: k, secondsLeft: remaining)
                if remaining == 15 { self.speak(HomeStrings.fallAlertReminder(remaining, self.lang)) }
            }
            guard let self, !Task.isCancelled, case .countdown = self.phase else { return }
            await self.send()
        }
    }

    /// 用户确认没事：取消倒计时。
    func cancel() {
        guard case .countdown = phase else { return }
        countdownTask?.cancel(); countdownTask = nil
        phase = .idle
        speak(HomeStrings.fallAlertCancelled(lang))
    }

    /// 立即通知（不等倒计时）。
    func sendNow() {
        guard case .countdown = phase else { return }
        countdownTask?.cancel(); countdownTask = nil
        Task { await send() }
    }

    private func send() async {
        guard case .countdown(let kind, _) = phase else { return }
        phase = .sending
        // 尽力带上坐标：trigger 已发起 requestLocation；若立即发送（sendNow）时还没拿到定位，
        // 最多等约 3 秒抓一个 fix，拿到即带上。等不到也照发——紧急通知绝不因等 GPS 而延误（见 P2 审计）。
        if lastFix == nil {
            for _ in 0..<6 {
                try? await Task.sleep(for: .milliseconds(500))
                if lastFix != nil { break }
                guard case .sending = phase else { return } // 期间被新状态打断则放弃
            }
        }
        guard let token = KeychainStore.read() else {
            phase = .failed
            speak(HomeStrings.fallAlertNeedLogin(lang))
            scheduleReset()
            return
        }
        let result = await APIClient().postEmergencyAlert(token: token, kind: kind,
                                                          lat: lastFix?.coordinate.latitude,
                                                          lon: lastFix?.coordinate.longitude)
        if let notified = result {
            phase = .sent(notified: notified)
            speak(HomeStrings.fallAlertSent(notified, lang))
        } else {
            phase = .failed
            speak(HomeStrings.fallAlertFailed(lang))
        }
        scheduleReset()
    }

    /// 结果展示 8s 后回到待命（期间界面可见结果）。
    private func scheduleReset() {
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(8))
            guard let self, self.phase != .idle else { return }
            if case .countdown = self.phase { return } // 新一轮警报进行中不打扰
            self.phase = .idle
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in self.lastFix = locations.last }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    private func speak(_ text: String) {
        // 总线 .call 通道；VoiceOver 开启时总线内部走系统公告（不另调 A11y.announce 防双报）。
        SpeechHub.shared.speak(text, channel: .call, voiceCode: lang.voiceCode)
    }
}
