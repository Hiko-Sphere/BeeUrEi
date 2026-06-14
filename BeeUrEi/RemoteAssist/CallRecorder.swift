import Foundation
import ReplayKit
import AVFoundation
import CoreMedia
import UIKit

/// 通话录制器（Q6）：录制通话屏幕（含双方画面/UI）+ 应用音频（对端语音），写出本地 .mov 供上传留证。
/// 仅真机可用——模拟器无 ReplayKit，`isAvailable` 为 false；不可用时由调用方诚实处理，**绝不**假装在录。
///
/// 为什么用 `startCapture` + 自管 `AVAssetWriter`，而非 `startRecording`/`stopRecording(withOutput:)`：
/// 通话期间 WebRTC 独占麦克风并频繁重配音频会话（`RTCAudioSession`）。`startRecording` 若再开 ReplayKit
/// 麦克风（`isMicrophoneEnabled=true`），其内部录制会在音频会话被 WebRTC 重配的瞬间**被静默中断**——
/// 实测一通 80 秒的通话只录到 **1 帧 / 66ms** 的损坏文件，回放即"无法正常观看"。
/// 改用 `startCapture`：我们直接拿到屏幕视频与应用音频的 `CMSampleBuffer` 自己写盘，视频采集不依赖音频会话，
/// 且**不开 ReplayKit 麦克风**（避免与 WebRTC 抢麦），从而稳定录满整通时长。代价：录制不含本端自己的语音
/// （本端语音由 WebRTC 发往对端、不在应用音频输出中）；对端语音随"应用音频"完整录入。
final class CallRecorder {
    enum RecorderError: Error { case unavailable, notRecording, writerFailed }

    private let recorder = RPScreenRecorder.shared()
    private(set) var isRecording = false

    // 以下写入状态在 ReplayKit 串行回调线程与调用方线程间共享，统一用 lock 串行化。
    private let lock = NSLock()
    private var writer: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var audioInput: AVAssetWriterInput?
    private var sessionStarted = false
    private var outputURL: URL?

    /// 设备是否支持录制（真机且 ReplayKit 可用）。
    var isAvailable: Bool { recorder.isAvailable }

    /// 开始录制。失败抛错由调用方诚实处理。
    func start() async throws {
        guard recorder.isAvailable else { throw RecorderError.unavailable }
        guard !isRecording else { return }
        recorder.isMicrophoneEnabled = false // 关键：不抢麦，避免与 WebRTC 冲突导致录制中断（见类注释）

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("beeurei-call-\(UUID().uuidString).mov")
        let assetWriter = try AVAssetWriter(outputURL: url, fileType: .mov)

        // 视频输入：用屏幕原生像素尺寸（ReplayKit 按屏幕分辨率采集）。
        let px = await MainActor.run { UIScreen.main.nativeBounds.size }
        let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(px.width),
            AVVideoHeightKey: Int(px.height),
        ])
        vIn.expectsMediaDataInRealTime = true
        let aIn = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVNumberOfChannelsKey: 2,
            AVSampleRateKey: 44_100,
            AVEncoderBitRateKey: 128_000,
        ])
        aIn.expectsMediaDataInRealTime = true
        if assetWriter.canAdd(vIn) { assetWriter.add(vIn) }
        if assetWriter.canAdd(aIn) { assetWriter.add(aIn) }

        lock.lock()
        writer = assetWriter; videoInput = vIn; audioInput = aIn; outputURL = url; sessionStarted = false
        lock.unlock()

        do {
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
                recorder.startCapture(handler: { [weak self] sample, type, err in
                    self?.handle(sample, type: type, error: err)
                }, completionHandler: { err in
                    if let err { cont.resume(throwing: err) } else { cont.resume() }
                })
            }
        } catch {
            // 启动失败：清理 writer 状态后抛出。
            lock.lock(); writer = nil; videoInput = nil; audioInput = nil; outputURL = nil; sessionStarted = false; lock.unlock()
            throw error
        }
        isRecording = true
    }

    /// ReplayKit 串行回调线程：把视频/应用音频样本写入 writer。
    private func handle(_ sample: CMSampleBuffer, type: RPSampleBufferType, error: Error?) {
        guard error == nil, CMSampleBufferDataIsReady(sample) else { return }
        lock.lock(); defer { lock.unlock() }
        guard let w = writer, w.status != .failed else { return }
        switch type {
        case .video:
            if w.status == .unknown {
                // 首个视频样本启动写会话，以其 PTS 为起点。
                guard w.startWriting() else { return }
                w.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sample))
                sessionStarted = true
            }
            if sessionStarted, let vi = videoInput, vi.isReadyForMoreMediaData { vi.append(sample) }
        case .audioApp:
            if sessionStarted, let ai = audioInput, ai.isReadyForMoreMediaData { ai.append(sample) }
        case .audioMic:
            break // 不录麦克风
        @unknown default:
            break
        }
    }

    /// 停止采集并 finalize，返回写出的 .mov 本地 URL（供上传后删除）。
    func stop() async throws -> URL {
        guard isRecording else { throw RecorderError.notRecording }
        // 先停采集（忽略其错误，尽力 finalize 已写入内容），再收尾 writer。
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            recorder.stopCapture { _ in cont.resume() }
        }
        isRecording = false
        return try await finalize()
    }

    private func finalize() async throws -> URL {
        lock.lock()
        let w = writer; let url = outputURL; let vi = videoInput; let ai = audioInput; let ok = sessionStarted
        writer = nil; videoInput = nil; audioInput = nil; outputURL = nil; sessionStarted = false
        lock.unlock()
        guard let w, let url else { throw RecorderError.writerFailed }
        vi?.markAsFinished(); ai?.markAsFinished()
        guard ok, w.status == .writing else { w.cancelWriting(); throw RecorderError.writerFailed }
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            w.finishWriting { cont.resume() }
        }
        if w.status == .failed { throw RecorderError.writerFailed }
        return url
    }

    /// 取消（出错兜底）：尽力停掉采集、丢弃输出，不抛错。
    func cancel() async {
        guard isRecording else { return }
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            recorder.stopCapture { _ in cont.resume() }
        }
        isRecording = false
        lock.lock(); let w = writer; let url = outputURL; writer = nil; videoInput = nil; audioInput = nil; outputURL = nil; sessionStarted = false; lock.unlock()
        w?.cancelWriting()
        if let url { try? FileManager.default.removeItem(at: url) }
    }
}
