import Foundation
import AVFoundation
import UIKit

/// 红绿灯三通道反馈（Oko 式）：**节奏音频 + 节奏震动**（第三通道全屏色块由 HomeView 渲染）。
/// 红=慢节奏低音(1Hz)、黄=中节奏中音(~1.7Hz)、绿=快节奏高音(3Hz)：
/// 全盲靠声音节奏、嘈杂街口靠震动节奏、低视力靠高对比色块——盲聋用户也能用（只靠震动）。
/// 节奏在语音之外持续给出状态，过街全程不需要反复听句子。
final class CrossingSignalFeedback {
    private var timer: Timer?
    private var current: TrafficLightState = .unknown
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var tones: [TrafficLightState: AVAudioPCMBuffer] = [:]
    private let haptic = UIImpactFeedbackGenerator(style: .heavy)

    init() {
        engine.attach(player)
        let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
        engine.connect(player, to: engine.mainMixerNode, format: format)
        tones[.red] = Self.tone(format: format, frequency: 392)     // 低音 G4
        tones[.yellow] = Self.tone(format: format, frequency: 587)  // 中音 D5
        tones[.green] = Self.tone(format: format, frequency: 988)   // 高音 B5
    }

    /// 状态变化时调用：unknown 停止节奏，红/黄/绿按各自节奏持续蜂鸣+震动。
    func update(_ state: TrafficLightState) {
        guard state != current else { return }
        current = state
        timer?.invalidate(); timer = nil
        guard state != .unknown else { return }
        let interval: TimeInterval = state == .green ? 0.33 : (state == .yellow ? 0.6 : 1.0)
        haptic.prepare()
        tick() // 立即给第一拍，不等首个间隔
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in self?.tick() }
    }

    func stop() {
        timer?.invalidate(); timer = nil
        current = .unknown
        if engine.isRunning { player.stop(); engine.stop() }
    }

    deinit { timer?.invalidate(); if engine.isRunning { engine.stop() } }

    private func tick() {
        guard let buffer = tones[current] else { return }
        if !engine.isRunning {
            do { try engine.start(); player.play() } catch { return }
        }
        player.scheduleBuffer(buffer, at: nil, options: [.interrupts], completionHandler: nil)
        haptic.impactOccurred()
        haptic.prepare() // 每拍后重新预热 Taptic 引擎，保持持续节奏不衰减/不延迟（见 P2 审计）
    }

    private static func tone(format: AVAudioFormat, frequency: Float, durationSeconds: Float = 0.09) -> AVAudioPCMBuffer? {
        let frames = AVAudioFrameCount(format.sampleRate * Double(durationSeconds))
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
              let channel = buffer.floatChannelData else { return nil }
        buffer.frameLength = frames
        let sampleRate = Float(format.sampleRate)
        for i in 0..<Int(frames) {
            // 短促帯包络的正弦：避免咔哒声。
            let t = Float(i) / Float(frames)
            let envelope = sin(.pi * t)
            channel[0][i] = 0.28 * envelope * sin(2 * .pi * frequency * Float(i) / sampleRate)
        }
        return buffer
    }
}
