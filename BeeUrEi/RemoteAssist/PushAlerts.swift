import SwiftUI
import UserNotifications
import UIKit

/// 软件外通知（普通 APNs 提醒推送）：好友请求/被接受等。
/// 区别于 PushKit VoIP（RemoteAssistService 处理来电）。本类管理"提醒类"推送的授权、token 上报与前台横幅。
@MainActor
@Observable
final class PushAlerts {
    static let shared = PushAlerts()
    private(set) var deviceTokenHex: String?

    /// 拿到 token（didRegister）后调用：缓存并在已登录时上报。
    func setDeviceToken(_ hex: String) {
        deviceTokenHex = hex
        Task { await uploadIfPossible() }
    }

    /// 登录后调用：若已有 token 则上报（token 可能早于登录到达）。
    func uploadIfPossible() async {
        guard let hex = deviceTokenHex, let token = KeychainStore.read() else { return }
        await APIClient().registerApnsToken(token: token, apnsToken: hex)
    }

    /// 退出登录时注销（尽力而为）。
    func unregister() async {
        guard let token = KeychainStore.read() else { return }
        await APIClient().unregisterApnsToken(token: token)
    }
}

/// App 委托：仅用于普通远程通知（授权 + 注册 + 前台横幅）。VoIP 由 PushKit 单独处理。
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { application.registerForRemoteNotifications() }
        }
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in PushAlerts.shared.setDeviceToken(hex) }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // 真机无网络/未配推送时会失败；不阻断 App（应用内通知仍可用）。
    }

    // 前台也显示横幅（否则 App 开着时收不到提醒）。
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        // 紧急"回执"（家人已收到 emergency_ack / 报平安 emergency_clear）**读出来**：发起 SOS 的盲人此刻
        // 最需要听到"家人已收到、正在赶来"，而横幅是视觉的、默认提示音不传达内容——对盲人等于没收到（无障碍攸关）。
        let content = notification.request.content
        if let text = EmergencyReplyAnnouncement.spokenText(kind: content.userInfo["kind"] as? String,
                                                            title: content.title, body: content.body,
                                                            language: FeatureSettings().language) {
            let voice = FeatureSettings().language.voiceCode
            await MainActor.run { SpeechHub.shared.speak(text, channel: .query, voiceCode: voice) }
        }
        return [.banner, .sound, .badge]
    }

    // 点击通知：来电横幅 → 直接进入接听界面；其余 → 打开 App 即可（应用内已展示请求）。
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        if info["kind"] as? String == "incoming_call", let callId = info["callId"] as? String {
            let name = response.notification.request.content.title
            await MainActor.run { IncomingCallCenter.shared.present(callId: callId, callerName: name) }
        } else {
            await NotificationsCenter.shared.refresh()
        }
    }
}
