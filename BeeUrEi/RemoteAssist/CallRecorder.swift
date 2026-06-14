import Foundation
import ReplayKit

/// 通话录制器（Q6）：用系统 ReplayKit 录制通话屏幕（含双方画面/UI）+ 应用音频（对端语音）+ 麦克风（本端语音），
/// 写出到本地 .mov 文件，供上传留证。仅真机可用——模拟器无 ReplayKit，`isAvailable` 为 false；
/// 不可用时由调用方按"录制不可用"诚实处理，**绝不**假装在录（无 mock/占位）。
///
/// 设计取舍：相机/麦克风在通话期间由 WebRTC 独占，无法再开一路 AVCaptureSession；ReplayKit 录的是
/// App 的音视频输出（系统级、稳定编码），既含本端相机画面也含远端画面，是最完整、最不与 WebRTC 抢资源的方案。
@MainActor
final class CallRecorder {
    enum RecorderError: Error { case unavailable, notRecording }

    private let recorder = RPScreenRecorder.shared()
    private(set) var isRecording = false

    /// 设备是否支持录制（真机且 ReplayKit 可用）。
    var isAvailable: Bool { recorder.isAvailable }

    /// 开始录制（含麦克风）。失败抛错由调用方诚实处理。
    func start() async throws {
        guard recorder.isAvailable else { throw RecorderError.unavailable }
        guard !isRecording else { return }
        recorder.isMicrophoneEnabled = true // 录入本端语音；对端语音随"应用音频"已被捕获
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            recorder.startRecording { error in
                if let error { cont.resume(throwing: error) } else { cont.resume() }
            }
        }
        isRecording = true
    }

    /// 停止并写出 .mov 到临时目录，返回其本地 URL（供上传后删除）。
    func stop() async throws -> URL {
        guard isRecording else { throw RecorderError.notRecording }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("beeurei-call-\(UUID().uuidString).mov")
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            recorder.stopRecording(withOutput: url) { error in
                if let error { cont.resume(throwing: error) } else { cont.resume() }
            }
        }
        isRecording = false
        return url
    }

    /// 取消（出错兜底）：尽力停掉录制、丢弃输出，不抛错。
    func cancel() async {
        guard isRecording else { return }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("beeurei-call-discard-\(UUID().uuidString).mov")
        try? await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            recorder.stopRecording(withOutput: tmp) { error in
                if let error { cont.resume(throwing: error) } else { cont.resume() }
            }
        }
        try? FileManager.default.removeItem(at: tmp)
        isRecording = false
    }
}
