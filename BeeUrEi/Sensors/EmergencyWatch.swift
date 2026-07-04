import Foundation
import CoreMotion
import CoreLocation
import SwiftUI
import UIKit // UIAccessibility.isVoiceOverRunning：倒计时取消提示按是否开 VoiceOver 切换（教 Magic Tap vs 指按钮）

/// 摔倒/剧烈撞击监测（加速度计 20Hz → 核心 FallDetector 状态机，已测）。
/// 主页运行期间持续监测（手机在口袋/手中行走是主要场景）。
final class MotionMonitor {
    private let motion = CMMotionManager()
    private var detector = FallDetector()
    private let queue = OperationQueue()

    func start(onEvent: @escaping (FallDetector.Event) -> Void) {
        guard motion.isAccelerometerAvailable, !motion.isAccelerometerActive else { return }
        queue.maxConcurrentOperationCount = 1 // 串行：detector 只在此队列被读写，杜绝 ingest 与 reset 跨线程竞争
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
        // 在采集同一串行队列上复位：否则主线程 reset 可能与在途回调里的 ingest 并发改 detector（数据竞争），
        // 半复位状态被读出可能误判为摔倒，在用户刚关闭监测时弹出**假**紧急倒计时。
        queue.addOperation { [weak self] in self?.detector.reset() }
    }
}

/// 紧急警报中心：检测到疑似摔倒/车祸 → 30s 倒计时（语音+全屏警报卡，可取消）→
/// 无人取消则通知所有 accepted 绑定亲友（后端推送，附最近位置）。
/// 语音全部走总线 .call 通道（最高非避障级）：不与避障/导航/识别播报重叠。
@MainActor
@Observable
final class EmergencyAlertCenter: NSObject, CLLocationManagerDelegate {
    static let shared = EmergencyAlertCenter()

    enum Phase: Equatable { case idle, countdown(kind: String, secondsLeft: Int), sending, sent(reached: Int), failed }
    private(set) var phase: Phase = .idle

    @ObservationIgnored private var countdownTask: Task<Void, Never>?
    @ObservationIgnored private let location = CLLocationManager()
    @ObservationIgnored private var lastFix: CLLocation?
    @ObservationIgnored private var lastAlertId: String?   // 最近一次发出告警的 alertId，供"报平安"关联那次告警
    private var lang: Language { FeatureSettings().language }
    // 盲人开 VoiceOver 时，取消提示改教 Magic Tap（双指双击全屏任意处），比"找我没事按钮"在摔倒后可靠得多。
    private var voiceOverOn: Bool { UIAccessibility.isVoiceOverRunning }

    private override init() {
        super.init()
        location.delegate = self
        location.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    /// 触发警报流程（已有警报进行中时忽略，防连环触发刷屏）。
    func trigger(_ event: FallDetector.Event) {
        guard phase == .idle, event != .none else { return }
        beginCountdown(kind: event == .suspectedCrash ? "crash" : "fall")
    }

    /// 用户手动发起紧急求助（如未实名门禁屏的紧急按钮）。复用同一套倒计时+定位+通知+可取消流程。
    func manualSOS() {
        guard phase == .idle else { return }
        beginCountdown(kind: "manual")
    }

    private func beginCountdown(kind: String) {
        phase = .countdown(kind: kind, secondsLeft: 30)
        // 清掉上一轮紧急的缓存 fix：本中心是常驻单例，lastFix 从不复位。若不清，重复 SOS/摔倒会命中
        // send() 里 `lastFix == nil` 为假、跳过等新定位，直接发出**上一次**（可能在别处/家里）的旧坐标（见审计 EMERGENCY-STALE-LOC）。
        lastFix = nil
        location.requestWhenInUseAuthorization()
        location.requestLocation() // 提前定位，发送时带上
        speak(kind == "manual" ? HomeStrings.manualSosSpeak(voiceOver: voiceOverOn, lang) : HomeStrings.fallAlertSpeak(kind: kind, voiceOver: voiceOverOn, lang))
        countdownTask = Task { [weak self] in
            for remaining in stride(from: 29, through: 0, by: -1) {
                try? await Task.sleep(for: .seconds(1))
                guard let self, !Task.isCancelled else { return }
                guard case .countdown(let k, _) = self.phase else { return }
                self.phase = .countdown(kind: k, secondsLeft: remaining)
                if remaining == 15 { self.speak(HomeStrings.fallAlertReminder(remaining, voiceOver: self.voiceOverOn, self.lang)) }
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

    /// 告警**已发出后**报平安：广播"我没事了"给亲友，解除刚才那次告警（让担心/正赶来的人立刻安心）。
    /// 安全类 App 的 all-clear 闭环——倒计时内取消(cancel)是不发告警；发出后才用本方法解除。仅 .sent 后可用。
    func allClear() {
        guard case .sent = phase else { return }
        let aid = lastAlertId
        phase = .idle
        speak(HomeStrings.allClearSpeak(lang))
        Task { if let token = KeychainStore.read() { _ = await APIClient().postEmergencyAllClear(token: token, alertId: aid) } }
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
        // 带 backoff **重试**发送：紧急时网络最可能不稳（摔在地下室/电梯/信号差处、用户可能已失能无法
        // 手动重试），单次失败绝不能放弃。间隔 0/3/6/12/20s 共 5 次（≤ 服务端 6/min 限流）；每次用**同一**
        // alertId，服务端据此幂等去重——即便某次其实已送达只是回执丢了，重试也绝不会让亲友收到重复告警。
        let alertId = UUID().uuidString
        lastAlertId = alertId   // 记住本次告警 id，供发出后"报平安"关联解除
        let backoffs: [Double] = [0, 3, 6, 12, 20]
        var reached: Int?
        for delay in backoffs {
            if delay > 0 {
                try? await Task.sleep(for: .seconds(delay))
                guard case .sending = phase else { return } // 期间被取消/新状态打断则放弃重试
            }
            // 每次重试都取**当下最新鲜**坐标（>60s 陈旧 fix 宁可不带——附错误旧位置比不附更危险）；
            // 重试期间若刚拿到 GPS fix 即可带上。
            let fix = lastFix.flatMap { Date().timeIntervalSince($0.timestamp) < 60 ? $0 : nil }
            reached = await APIClient().postEmergencyAlert(token: token, kind: kind,
                                                           lat: fix?.coordinate.latitude,
                                                           lon: fix?.coordinate.longitude,
                                                           alertId: alertId)
            if reached != nil { break }
        }
        if let reached {
            phase = .sent(reached: reached)
            speak(HomeStrings.fallAlertSent(reached, lang))
            scheduleReset(after: 30) // .sent 停留更久：给盲人 VoiceOver 足够时间找到并点"报平安"解除告警
        } else {
            phase = .failed
            speak(HomeStrings.fallAlertFailed(lang))
            // 无网兜底：重试全败多半是没有数据网络——tel: 蜂窝语音不依赖数据。缓存里有紧急联系人
            // 电话就唤起系统拨号确认（不静默直拨，系统弹"呼叫…?"，VoiceOver 可确认/取消）。
            EmergencyDialCache.dialFallbackIfAvailable(lang: lang) { speak($0) }
            scheduleReset()
        }
    }

    /// 结果展示若干秒后回到待命（期间界面可见结果）。默认 8s；.sent 用更长窗口，供"报平安"操作。
    private func scheduleReset(after seconds: Double = 8) {
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
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
