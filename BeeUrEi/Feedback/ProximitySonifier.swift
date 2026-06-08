import Foundation
import AVFoundation

/// 接近声呐（倒车雷达式）：把核心 `ProximityCue`（间隔/音高）变成实际蜂鸣——越近越密、音高越高。
/// 多通道反馈：在不便听语音/语音间隙提供连续距离感（竞品多只有 TTS）。
final class ProximitySonifier {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
    /// 专用串行队列：所有共享状态(started/currentPitch/currentInterval/timer)与音频引擎调用都在此队列，
    /// 避免定时器回调与主线程 update/stop 的数据竞争（见审查 #1）。
    private let queue = DispatchQueue(label: "com.beeurei.sonifier")
    private var timer: DispatchSourceTimer?
    private var started = false
    private var currentInterval: Double = -1
    private var currentPitch: Double = 800

    init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
    }

    deinit { queue.sync { teardown() } }

    /// 每帧用最近距离的提示音参数更新；nil（无目标/太远）则停止蜂鸣。
    func update(_ cue: ProximityCue?) {
        queue.async { [weak self] in self?.applyUpdate(cue) }
    }

    func stop() {
        queue.async { [weak self] in self?.teardown() }
    }

    private func applyUpdate(_ cue: ProximityCue?) {
        guard let cue else { teardown(); return }
        currentPitch = cue.pitchHz
        // 用 engine.isRunning 判断而非粘滞的 started：来电/Siri/媒体重置会停掉引擎但**不会**复位 started，
        // 若只看 started 则中断后永不重启、声呐永久失声。检测引擎实际未运行就重启（见审查 #2，与 SpatialAudio 一致）。
        if !engine.isRunning {
            do {
                try engine.start()
                player.play()
                started = true
            } catch {
                started = false
                return
            }
        }
        if timer == nil || abs(currentInterval - cue.beepIntervalSeconds) > 0.001 {
            currentInterval = cue.beepIntervalSeconds
            restartTimer()
        }
    }

    /// 彻底停止：取消定时器 + 停 player/engine + 复位 started（释放音频会话、可恢复）。
    private func teardown() {
        timer?.cancel()
        timer = nil
        currentInterval = -1
        if started {
            player.stop()
            engine.stop()
            started = false
        }
    }

    private func restartTimer() {
        timer?.cancel()
        let t = DispatchSource.makeTimerSource(queue: queue) // 与共享状态同队列，串行无竞争
        t.schedule(deadline: .now(), repeating: max(currentInterval, 0.05))
        t.setEventHandler { [weak self] in self?.beep() }
        timer = t
        t.resume()
    }

    private func beep() {
        guard started, engine.isRunning else { return }
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
