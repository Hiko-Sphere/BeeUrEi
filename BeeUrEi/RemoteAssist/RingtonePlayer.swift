import Foundation
import AVFoundation
import AudioToolbox

/// 来电铃协议（可注入：单测用 mock 静音）。
protocol RingtonePlaying: AnyObject {
    func start()
    func stop()
}

/// 应用内来电铃：程序生成的经典双音铃声（440+480Hz，响 1.5s/停 1.5s 循环）+ 每 2s 一次系统振动。
/// 程序生成省去音频资源文件；AVAudioPlayer 走 .playback 会话（AudioSessionManager），静音开关下仍响铃——
/// 盲人用户的来电不能因静音被吞掉。懒创建：不进来电不碰音频设施。
final class RingtonePlayer: RingtonePlaying {
    private var player: AVAudioPlayer?
    private var vibrateTimer: Timer?

    func start() {
        // 显式把会话置为 .playback 并激活——确保来电铃**无视静音开关**响起，且不依赖上一通话是否正确恢复了
        // 会话（异常结束可能把会话留在 .playAndRecord/未激活态，导致铃声被静音吞掉，见 P2 审计）。
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, options: [.duckOthers])
        try? session.setActive(true)
        if player == nil {
            player = try? AVAudioPlayer(data: Self.ringtoneWAV())
            player?.numberOfLoops = -1 // 循环体内含静默段，无限循环即"响-停-响"
            player?.volume = 0.8
        }
        player?.currentTime = 0
        player?.play()
        vibrateTimer?.invalidate()
        let timer = Timer(timeInterval: 2.0, repeats: true) { _ in
            AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        }
        RunLoop.main.add(timer, forMode: .common)
        timer.fire() // 立即先振一次
        vibrateTimer = timer
    }

    func stop() {
        player?.stop()
        vibrateTimer?.invalidate()
        vibrateTimer = nil
    }

    /// 生成铃声 WAV（16-bit PCM 单声道 22050Hz）：1.5s 双音（440+480Hz）+ 1.5s 静默为一个循环体；
    /// 20ms 振幅淡入淡出防爆音。
    private static func ringtoneWAV() -> Data {
        let sampleRate = 22050
        let ringSamples = Int(1.5 * Double(sampleRate))
        let totalSamples = ringSamples + Int(1.5 * Double(sampleRate))
        let fade = Int(0.02 * Double(sampleRate))
        var pcm = [Int16](repeating: 0, count: totalSamples)
        for i in 0..<ringSamples {
            let t = Double(i) / Double(sampleRate)
            var amp = 0.35 * (sin(2 * .pi * 440 * t) + sin(2 * .pi * 480 * t)) / 2
            if i < fade { amp *= Double(i) / Double(fade) }
            if i > ringSamples - fade { amp *= Double(ringSamples - i) / Double(fade) }
            pcm[i] = Int16(max(-1, min(1, amp)) * 32767)
        }
        let dataSize = totalSamples * 2
        var wav = Data(capacity: 44 + dataSize)
        func append(_ s: String) { wav.append(contentsOf: Array(s.utf8)) }
        func append32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { wav.append(contentsOf: $0) } }
        func append16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { wav.append(contentsOf: $0) } }
        append("RIFF"); append32(UInt32(36 + dataSize)); append("WAVE")
        append("fmt "); append32(16); append16(1) // PCM
        append16(1)  // 单声道
        append32(UInt32(sampleRate))
        append32(UInt32(sampleRate * 2)) // byte rate
        append16(2)  // block align
        append16(16) // bits per sample
        append("data"); append32(UInt32(dataSize))
        pcm.withUnsafeBytes { wav.append(contentsOf: $0) }
        return wav
    }
}
