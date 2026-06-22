import Foundation
import AVFoundation
import UIKit

/// 全 App 语音总线（避障 SpeechFeedback 之外的唯一出声口）：导航/识别/环境感知/来电
/// 共用**一个**合成器 + SpeechGate 仲裁（核心，已测）。修"避障语音与导航/查询语音同时出声"：
/// - 避障开播 → `safetyWillSpeak()`：立即掐断总线正在播的内容（其文本积压待补播）并挂起；
/// - 挂起期间：取景提示丢弃；导航指令/查询结果/来电播报积压**每通道最新一条**，避障说完按优先级补播；
/// - 平时：来电 > 导航 > 查询，高打断低、低积压等高；同通道导航排队顺读、提示不打断结果。
/// VoiceOver 开启时改走系统公告（VO 自带队列，与避障的 VO 公告自然排队），仅保留"忙时丢提示"闸门。
final class SpeechHub: NSObject {
    static let shared = SpeechHub()

    private let synthesizer = AVSpeechSynthesizer()
    /// 正在播的内容（含文本：被避障掐断时积压回去，避障说完重播——指令不丢）。
    private var current: (channel: SpeechChannel, droppable: Bool, text: String, rate: Float?, voice: String?)?
    /// 积压区：每通道仅留最新一条（旧指令过期即覆盖）。
    private var stash: [SpeechChannel: (text: String, rate: Float?, voice: String?)] = [:]
    /// 避障播报进行中：总线整体让位。
    private var safetyHold = false
    /// 主动掐断换句的过渡窗：忽略此间到达的 didCancel，防止误清状态/误触发补播。
    private var transitioning = false

    private override init() {
        super.init()
        synthesizer.delegate = self
    }

    /// 状态只在主线程动（合成器自身线程安全，但 current/stash 不是；调用方有 UI/帧回调/定位回调多种线程）。
    private func onMain(_ body: @escaping () -> Void) {
        if Thread.isMainThread { body() } else { DispatchQueue.main.async(execute: body) }
    }

    /// - Parameters:
    ///   - channel: 通道优先级（查询/导航/来电）。
    ///   - rate: nil 用全局语速设置。
    ///   - voiceCode: nil 用全局语言嗓音；中文硬编码文案传 "zh-CN" 防英文嗓念中文。
    ///   - droppable: 提示类（取景方向/还在找）——忙时直接丢弃、永不打断结果。
    func speak(_ text: String, channel: SpeechChannel, rate: Float? = nil,
               voiceCode: String? = nil, droppable: Bool = false) {
        guard !text.isEmpty else { return }
        onMain { self.speakOnMain(text, channel: channel, rate: rate, voice: voiceCode, droppable: droppable) }
    }

    private func speakOnMain(_ text: String, channel: SpeechChannel, rate: Float?, voice: String?, droppable: Bool) {
        if UIAccessibility.isVoiceOverRunning {
            if droppable, safetyHold || synthesizer.isSpeaking { return }
            // VoiceOver 串行播报：用公告优先级表达通道优先级，让时间攸关的内容（转向指令/识别结果）
            // 不被信息性 callout（途经地标/进入路名，droppable）拖在队尾。
            // droppable → .low：VoiceOver 正忙时直接丢弃（信息性可弃）；非 droppable → .default：排队必读。
            // 避障的紧急警告仍以 .high 公告凌驾其上（SpeechFeedback），安全优先级不变。
            let priority: UIAccessibilityPriority = droppable ? .low : .default
            let announcement = NSAttributedString(string: text, attributes: [
                .accessibilitySpeechAnnouncementPriority: priority,
            ])
            UIAccessibility.post(notification: .announcement, argument: announcement)
            return
        }
        let cur = synthesizer.isSpeaking ? current.map { (channel: $0.channel, droppable: $0.droppable) } : nil
        switch SpeechGate.action(newChannel: channel, newDroppable: droppable, current: cur, safetyHold: safetyHold) {
        case .drop:
            return
        case .stash:
            stash[channel] = (text, rate, voice)
        case .speakEnqueue:
            current = (channel, droppable, text, rate, voice)
            synthesizer.speak(makeUtterance(text, rate: rate, voice: voice))
        case .speakInterrupt:
            transitioning = true
            if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
            current = (channel, droppable, text, rate, voice)
            synthesizer.speak(makeUtterance(text, rate: rate, voice: voice))
            transitioning = false
        }
    }

    /// 停掉某通道（导航停止时清导航语音）：不波及其他通道正在播的内容。
    func stopChannel(_ channel: SpeechChannel) {
        onMain {
            self.stash[channel] = nil
            guard let c = self.current, c.channel == channel else { return }
            self.transitioning = true
            self.synthesizer.stopSpeaking(at: .immediate)
            self.transitioning = false
            self.current = nil
            self.flushStash()
        }
    }

    /// 全停（不动 safetyHold——它由避障通道配对管理）。
    func stopAll() {
        onMain {
            self.stash.removeAll()
            self.transitioning = true
            self.synthesizer.stopSpeaking(at: .immediate)
            self.transitioning = false
            self.current = nil
        }
    }

    // MARK: 避障让位（SpeechFeedback 在每条带语音的避障播报前后调用）

    /// 避障即将开口：掐断总线，被掐的非提示内容积压回去（避障说完重播，指令不丢）。
    func safetyWillSpeak() {
        onMain {
            self.safetyHold = true
            guard self.synthesizer.isSpeaking else { return }
            if let c = self.current, !c.droppable { self.stash[c.channel] = (c.text, c.rate, c.voice) }
            self.transitioning = true
            self.synthesizer.stopSpeaking(at: .immediate)
            self.transitioning = false
            self.current = nil
        }
    }

    /// 避障播报结束：解除让位，按优先级补播积压内容。
    func safetyDidFinish() {
        onMain {
            guard self.safetyHold else { return }
            self.safetyHold = false
            self.flushStash()
        }
    }

    /// 取积压区最高优先级一条播出（其余留待 didFinish 链式补播）。
    private func flushStash() {
        guard !safetyHold, !synthesizer.isSpeaking, let top = stash.keys.max(),
              let item = stash.removeValue(forKey: top) else { return }
        speakOnMain(item.text, channel: top, rate: item.rate, voice: item.voice, droppable: false)
    }

    private func makeUtterance(_ text: String, rate: Float?, voice: String?) -> AVSpeechUtterance {
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: voice ?? FeatureSettings().language.voiceCode)
        let t = rate ?? FeatureSettings().speechRate
        u.rate = AVSpeechUtteranceMinimumSpeechRate
            + (AVSpeechUtteranceMaximumSpeechRate - AVSpeechUtteranceMinimumSpeechRate) * t
        return u
    }
}

extension SpeechHub: AVSpeechSynthesizerDelegate {
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        onMain { self.utteranceEnded() }
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        onMain { self.utteranceEnded() }
    }

    private func utteranceEnded() {
        // 过渡窗内的 didCancel（主动换句触发）不动状态；队列里还有（导航多行顺读）也不动。
        guard !transitioning, !synthesizer.isSpeaking else { return }
        current = nil
        flushStash()
    }
}
