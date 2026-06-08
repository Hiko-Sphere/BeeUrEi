import Foundation
import AVFoundation

/// 接近声呐（倒车雷达式）：把核心 `ProximityCue`（间隔/音高）变成实际蜂鸣——越近越密、音高越高。
/// 多通道反馈：在不便听语音/语音间隙提供连续距离感（竞品多只有 TTS）。
final class ProximitySonifier {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
    private var timer: DispatchSourceTimer?
    private var started = false
    private var currentInterval: Double = -1
    private var currentPitch: Double = 800

    init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
    }

    /// 每帧用最近距离的提示音参数更新；nil（无目标/太远）则停止蜂鸣。
    func update(_ cue: ProximityCue?) {
        guard let cue else { stop(); return }
        currentPitch = cue.pitchHz
        if !started {
            try? engine.start()
            player.play()
            started = true
        }
        if timer == nil || abs(currentInterval - cue.beepIntervalSeconds) > 0.001 {
            currentInterval = cue.beepIntervalSeconds
            restartTimer()
        }
    }

    func stop() {
        timer?.cancel()
        timer = nil
        currentInterval = -1
    }

    private func restartTimer() {
        timer?.cancel()
        let t = DispatchSource.makeTimerSource(queue: .global(qos: .userInitiated))
        t.schedule(deadline: .now(), repeating: max(currentInterval, 0.05))
        t.setEventHandler { [weak self] in self?.beep() }
        timer = t
        t.resume()
    }

    private func beep() {
        guard started else { return }
        let buffer = ProximitySonifier.tone(format: format, frequency: Float(currentPitch))
        player.scheduleBuffer(buffer, at: nil, options: [.interrupts], completionHandler: nil)
    }

    private static func tone(format: AVAudioFormat, frequency: Float, durationSeconds: Float = 0.06) -> AVAudioPCMBuffer {
        let frames = AVAudioFrameCount(format.sampleRate * Double(durationSeconds))
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        let sampleRate = Float(format.sampleRate)
        if let channel = buffer.floatChannelData {
            for i in 0..<Int(frames) {
                // 加淡入淡出包络，避免爆音。
                let env = sin(Float.pi * Float(i) / Float(frames))
                channel[0][i] = 0.18 * env * sin(2 * .pi * frequency * Float(i) / sampleRate)
            }
        }
        return buffer
    }
}
