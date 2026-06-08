import Foundation
import AVFoundation

/// 全局音频会话管理——安全攸关 App 的危险警告音必须可靠发声。
///
/// 此前全工程从不配置 AVAudioSession，默认 `.soloAmbient`/`.ambient` 类别会**遵从静音开关**：
/// 盲人用户把手机拨到静音时，避障/导航的语音与空间音信标会完全无声，危险警告彻底丢失（严重安全缺口）。
/// 且无 ducking 时会被背景音乐/播客盖过，来电/Siri 中断后音频引擎不重新激活会永久失声。
///
/// 修复（见反馈输出深审 #1/#2/#9/#12）：
/// - `.playback` 类别：**无视静音开关**仍发声（安全警告不应被静音消音）；
/// - `.duckOthers + .interruptSpokenAudioAndMixWithOthers`：压低音乐、让出播客，不与之互斥；
/// - 监听中断通知：结束时重新激活会话并广播，让各 AVAudioEngine 通道(空间音/接近声呐)重启。
enum AudioSessionManager {
    /// 音频中断(来电/Siri)结束、会话已重新激活——各音频引擎应据此重启自身。
    static let interruptionEndedNotification = Notification.Name("beeurei.audio.interruptionEnded")

    private static var observer: NSObjectProtocol?

    /// App 启动时调用一次：配置并激活音频会话，订阅中断通知。
    static func configure() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .voicePrompt,
                                 options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try? session.setActive(true)
        if observer == nil {
            observer = NotificationCenter.default.addObserver(
                forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { note in
                handleInterruption(note)
            }
        }
    }

    private static func handleInterruption(_ note: Notification) {
        guard let info = note.userInfo,
              let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw),
              type == .ended else { return }
        // 中断结束：重新激活会话，再广播让各引擎重启（否则一次来电后信标/声呐永久失声）。
        try? AVAudioSession.sharedInstance().setActive(true)
        NotificationCenter.default.post(name: interruptionEndedNotification, object: nil)
    }
}
