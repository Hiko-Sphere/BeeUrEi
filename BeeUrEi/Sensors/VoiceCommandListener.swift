import Foundation
import Speech
import AVFoundation
import AudioToolbox

/// 语音指令聆听（主屏麦克风键）：SFSpeech 识别一句话 → 核心 VoiceCommandParser 解析（已测）→ 回调执行。
/// - 尽量端侧识别（supportsOnDeviceRecognition 时强制 on-device，语音不出设备）；
/// - 聆听最长 8s，1.5s 静默自动结束；提示音用系统短音不占语音总线；
/// - 录音引擎按需创建（不在 init 碰音频设施——headless 测试安全教训）。
@MainActor
@Observable
final class VoiceCommandListener {
    enum Phase: Equatable { case idle, listening(partial: String), denied }
    private(set) var phase: Phase = .idle

    @ObservationIgnored private var engine: AVAudioEngine?
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var task: SFSpeechRecognitionTask?
    @ObservationIgnored private var silenceTimer: Task<Void, Never>?
    @ObservationIgnored private var lastHeard: TimeInterval = 0
    private var lang: Language { FeatureSettings().language }

    var isListening: Bool { if case .listening = phase { return true }; return false }

    /// 点击切换：空闲→开始聆听；聆听中→立即定稿。
    func toggle(onCommand: @escaping (VoiceCommand, String) -> Void) {
        if isListening { finish(onCommand: onCommand) } else { start(onCommand: onCommand) }
    }

    private func start(onCommand: @escaping (VoiceCommand, String) -> Void) {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            Task { @MainActor in
                guard let self else { return }
                guard status == .authorized else { self.phase = .denied; return }
                AVAudioApplication.requestRecordPermission { granted in
                    Task { @MainActor in
                        guard granted else { self.phase = .denied; return }
                        self.beginRecognition(onCommand: onCommand)
                    }
                }
            }
        }
    }

    private func beginRecognition(onCommand: @escaping (VoiceCommand, String) -> Void) {
        guard !isListening else { return }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang == .zh ? "zh-CN" : "en-US")),
              recognizer.isAvailable else { phase = .denied; return }

        // 录音会话（结束后恢复 .playback——否则避障警告会被静音开关重新消音，同通话恢复逻辑）。
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers])
        try? session.setActive(true)

        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true } // 隐私：尽量端侧

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        engine.prepare()
        guard (try? engine.start()) != nil else {
            input.removeTap(onBus: 0)
            AudioSessionManager.configure()
            phase = .denied
            return
        }
        self.engine = engine
        self.request = request
        phase = .listening(partial: "")
        lastHeard = ProcessInfo.processInfo.systemUptime
        AudioServicesPlaySystemSound(1113) // 开始聆听提示音（系统短音，不占语音总线）

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                guard let self, self.isListening else { return }
                if let result {
                    self.phase = .listening(partial: result.bestTranscription.formattedString)
                    self.lastHeard = ProcessInfo.processInfo.systemUptime
                    if result.isFinal { self.finish(onCommand: onCommand) }
                }
                if error != nil { self.finish(onCommand: onCommand) }
            }
        }
        // 静默/超长看门狗：1.5s 没新字 或 总时长 8s → 定稿。
        let startAt = lastHeard
        silenceTimer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(300))
                guard let self, self.isListening else { return }
                let now = ProcessInfo.processInfo.systemUptime
                if now - self.lastHeard > 1.5 || now - startAt > 8 {
                    self.finish(onCommand: onCommand)
                    return
                }
            }
        }
    }

    /// 定稿：停止录音，解析当前识别文本并执行。
    private func finish(onCommand: @escaping (VoiceCommand, String) -> Void) {
        guard case .listening(let text) = phase else { return }
        phase = .idle
        silenceTimer?.cancel(); silenceTimer = nil
        task?.cancel(); task = nil
        request?.endAudio(); request = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop(); engine = nil
        AudioSessionManager.configure() // 恢复 .playback（无视静音开关的安全播报会话）
        AudioServicesPlaySystemSound(1114) // 结束提示音
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        onCommand(VoiceCommandParser.parse(trimmed), trimmed)
    }
}
