import Foundation
import AVFoundation

/// 空间音通道：用 AVAudioEngine + AVAudioEnvironmentNode 把提示音「挂」在某个方位（见 PLAN §7.2）。
/// 这里是最小可用的 3D 音频图；导航信标的完整实现见 Phase 2（参考 Soundscape）。
final class SpatialAudioFeedback: FeedbackSink {
    private let engine = AVAudioEngine()
    private let environment = AVAudioEnvironmentNode()
    private let player = AVAudioPlayerNode()
    private var toneBuffer: AVAudioPCMBuffer?
    private var started = false

    init() {
        engine.attach(environment)
        engine.attach(player)
        let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
        engine.connect(player, to: environment, format: format)
        engine.connect(environment, to: engine.mainMixerNode, format: nil)
        environment.listenerPosition = AVAudio3DPoint(x: 0, y: 0, z: 0)
        toneBuffer = SpatialAudioFeedback.makeTone(format: format)
    }

    /// FeedbackSink：播放一个非定向提示音。定向版用 `playCue(azimuthDegrees:)`。
    func play(_ event: FeedbackEvent) {
        playCue(azimuthDegrees: 0)
    }

    /// 旋转听者朝向（用 AirPods 头部偏航驱动，使信标保持世界固定；见 HeadTracker / PLAN §14 Q8）。
    func setListenerYaw(_ degrees: Float) {
        environment.listenerAngularOrientation = AVAudio3DAngularOrientation(yaw: degrees, pitch: 0, roll: 0)
    }

    /// 在给定方位角播放短提示音（右为正，单位度），声源置于听者前方 1m 处的该方位。
    func playCue(azimuthDegrees: Float) {
        guard let toneBuffer else { return }
        if !started {
            try? engine.start()
            player.play()
            started = true
        }
        let radians = azimuthDegrees * .pi / 180
        player.position = AVAudio3DPoint(x: sin(radians), y: 0, z: -cos(radians))
        player.scheduleBuffer(toneBuffer, at: nil, options: [.interrupts], completionHandler: nil)
    }

    private static func makeTone(format: AVAudioFormat,
                                 frequency: Float = 880,
                                 durationSeconds: Float = 0.12) -> AVAudioPCMBuffer? {
        let frames = AVAudioFrameCount(format.sampleRate * Double(durationSeconds))
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
              let channel = buffer.floatChannelData else { return nil }
        buffer.frameLength = frames
        let sampleRate = Float(format.sampleRate)
        for i in 0..<Int(frames) {
            channel[0][i] = 0.2 * sin(2 * .pi * frequency * Float(i) / sampleRate)
        }
        return buffer
    }
}
