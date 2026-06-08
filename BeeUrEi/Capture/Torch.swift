import AVFoundation

/// 手电筒（闪光灯）控制。与上层避障/识别同用后置相机；暗处照明以提升 OCR/识别成功率。
enum Torch {
    static var isOn: Bool {
        (AVCaptureDevice.default(for: .video)?.torchMode ?? .off) == .on
    }

    @discardableResult
    static func set(_ on: Bool) -> Bool {
        guard let device = AVCaptureDevice.default(for: .video), device.hasTorch else { return false }
        do {
            try device.lockForConfiguration()
            device.torchMode = on ? .on : .off
            device.unlockForConfiguration()
            return true
        } catch {
            return false
        }
    }
}
