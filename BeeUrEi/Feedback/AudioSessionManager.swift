import Foundation
import AVFoundation

/// 全局音频会话管理——安全攸关 App 的危险警告音必须可靠发声。
///
/// 此前全工程从不配置 AVAudioSession，默认 `.soloAmbient`/`.ambient` 类别会**遵从静音开关**：
/// 盲人用户把手机拨到静音时，避障/导航的语音与空间音信标会完全无声，危险警告彻底丢失（严重安全缺口）。
/// 且无 ducking 时会被背景音乐/播客盖过，来电/Siri 中断后音频引擎不重新激活会永久失声。
///
/// 修复（见反馈输出深审 #1/#2/#9/#12 与防回归复核）：
/// - `.playback` 类别：**无视静音开关**仍发声（安全警告不应被静音消音）；
/// - `.duckOthers + .interruptSpokenAudioAndMixWithOthers`：压低音乐、让出播客，不与之互斥；
/// - 监听中断：仅在系统建议 `.shouldResume` 时重新配置会话（遵循 Apple 规范）；
/// - 远程协助通话期间让出会话给 WebRTC（`.playAndRecord`），通话结束后 `endCall()` 恢复 `.playback`
///   （否则用过一次通话后，危险警告会被 WebRTC 留下的 `.playAndRecord` 重新置于静音开关之下）。
enum AudioSessionManager {
    private static var observer: NSObjectProtocol?
    /// 远程协助通话进行中：此时 WebRTC 接管会话（`.playAndRecord` + 自管激活），本管理器不抢占。
    private(set) static var callActive = false

    /// App 启动时调用一次，并在每次远程协助通话结束后再次调用：配置并激活避障/导航专用音频会话。
    /// 可安全重复调用（中断监听只注册一次）。
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

    /// 进入远程协助通话：让出会话给 WebRTC，期间本管理器不重配置/不抢激活。
    static func beginCall() { callActive = true }

    /// 远程协助通话结束：恢复避障/导航的 `.playback` 会话——否则用过通话后危险警告会被静音开关消音（见回归 #1）。
    static func endCall() {
        callActive = false
        configure()
    }

    private static func handleInterruption(_ note: Notification) {
        guard !callActive else { return } // 通话中由 WebRTC 自管会话，不与之抢占（见回归 #2）
        guard let info = note.userInfo,
              let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw),
              type == .ended else { return }
        // 仅当系统建议恢复时才重激活（Apple 规范，见回归 #2）；顺带把类别恢复成 .playback 并重激活。
        guard let optRaw = info[AVAudioSessionInterruptionOptionKey] as? UInt,
              AVAudioSession.InterruptionOptions(rawValue: optRaw).contains(.shouldResume) else { return }
        configure()
    }
}
