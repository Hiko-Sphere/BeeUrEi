import AVFoundation
import Vision
import UIKit
import SwiftUI

/// 实名认证证件拍摄相机：端侧 Vision 实时引导（证件矩形 / 人脸）+ 对准稳定后自动拍摄。
/// 无障碍：把"对准/再近一点/稳住"等引导经回调交给视图用 SpeechHub 朗读 + 触感；
/// 同时整屏可点的快门按钮兜底（盲人点屏任意处即可手动拍），并提供相册兜底。
/// 不依赖 LiDAR/ARKit——任何带摄像头的设备可用。
@MainActor
final class KYCCamera: NSObject, ObservableObject {
    enum Target { case document, face }
    enum Phase: Equatable { case starting, denied, searching, framing, locked, capturing, captured }

    @Published private(set) var phase: Phase = .starting
    @Published private(set) var guidance: String = ""

    let session = AVCaptureSession()
    private let target: Target
    private let lang: Language
    /// 引导句变化或对准锁定时回调（主线程）；视图据此朗读 + 触感。Bool=是否为"对准/拍好"的肯定提示。
    var onGuidance: ((String, Bool) -> Void)?
    var onCaptured: ((Data) -> Void)?

    private let sessionQueue = DispatchQueue(label: "kyc.camera.session")
    private let videoOutput = AVCaptureVideoDataOutput()
    private let photoOutput = AVCapturePhotoOutput()
    private var configured = false
    private var lastGuidanceKey = ""
    private var lastSpokenAt: TimeInterval = 0
    private var stableFrames = 0
    private var capturing = false

    init(target: Target, lang: Language) {
        self.target = target
        self.lang = lang
        super.init()
    }

    func start() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureAndRun()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                Task { @MainActor in granted ? self?.configureAndRun() : self?.deny() }
            }
        default:
            deny()
        }
    }

    private func deny() {
        phase = .denied
        emit(KYCStrings.camPermissionDenied(lang), positive: false, force: true)
    }

    private func configureAndRun() {
        phase = .searching
        emit(target == .face ? KYCStrings.camStartSelfie(lang) : KYCStrings.camStartDoc(lang), positive: false, force: true)
        sessionQueue.async { [weak self] in
            guard let self else { return }
            if !self.configured { self.configure() }
            if !self.session.isRunning { self.session.startRunning() }
        }
    }

    private func configure() {
        session.beginConfiguration()
        session.sessionPreset = .photo
        let position: AVCaptureDevice.Position = target == .face ? .front : .back
        if let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
            ?? AVCaptureDevice.default(for: .video),
           let input = try? AVCaptureDeviceInput(device: device),
           session.canAddInput(input) {
            session.addInput(input)
        }
        videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.setSampleBufferDelegate(self, queue: sessionQueue)
        if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
        if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }
        session.commitConfiguration()
        configured = true
    }

    func stop() {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            if self.session.isRunning { self.session.stopRunning() }
        }
    }

    /// 手动拍摄（整屏快门 / "拍摄"按钮）。
    func captureNow() {
        guard !capturing, configured else { return }
        triggerCapture()
    }

    private func triggerCapture() {
        guard !capturing else { return }
        capturing = true
        phase = .capturing
        let settings = AVCapturePhotoSettings()
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.photoOutput.capturePhoto(with: settings, delegate: self)
        }
    }

    // 主线程节流发声：引导句变化或距上次 ≥1.2s 才开口；肯定提示(positive)强制发。
    private func emit(_ text: String, positive: Bool, force: Bool = false) {
        guidance = text
        let now = ProcessInfo.processInfo.systemUptime
        let key = text
        if !force && key == lastGuidanceKey && now - lastSpokenAt < 1.2 { return }
        lastGuidanceKey = key
        lastSpokenAt = now
        onGuidance?(text, positive)
    }

    // 把检测到的目标几何（面积占比 + 偏离中心）转为引导。面积/居中度对旋转近似不变，故无需精确处理朝向。
    private func evaluate(area: CGFloat, center: CGPoint) {
        guard phase != .capturing, phase != .captured else { return }
        let offCenter = hypot(center.x - 0.5, center.y - 0.5)
        let minArea: CGFloat = target == .face ? 0.06 : 0.18
        let maxArea: CGFloat = target == .face ? 0.45 : 0.85
        if area < minArea {
            stableFrames = 0; phase = .framing
            emit(KYCStrings.camMoveCloser(lang), positive: false)
        } else if area > maxArea {
            stableFrames = 0; phase = .framing
            emit(KYCStrings.camMoveBack(lang), positive: false)
        } else if offCenter > 0.18 {
            stableFrames = 0; phase = .framing
            emit(target == .face ? KYCStrings.camStartSelfie(lang) : KYCStrings.camStartDoc(lang), positive: false)
        } else {
            // 对准：连续若干帧稳定后自动拍摄。
            phase = .locked
            stableFrames += 1
            emit(KYCStrings.camHold(lang), positive: true)
            if stableFrames >= 6 { triggerCapture() }
        }
    }

    private func noTarget() {
        guard phase != .capturing, phase != .captured else { return }
        stableFrames = 0
        phase = .searching
        emit(target == .face ? KYCStrings.camSearchingFace(lang) : KYCStrings.camSearching(lang), positive: false)
    }

    // 缩放 + 重编码为 JPEG（≤2048 长边，0.85）；UIImage 解码已归正朝向，绘制再统一。
    private func process(_ data: Data) -> Data? {
        guard let img = UIImage(data: data) else { return nil }
        let maxEdge: CGFloat = 2048
        let longest = max(img.size.width, img.size.height)
        let scale = longest > maxEdge ? maxEdge / longest : 1
        let newSize = CGSize(width: img.size.width * scale, height: img.size.height * scale)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1; format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: newSize, format: format).image { _ in
            img.draw(in: CGRect(origin: .zero, size: newSize))
        }
        return rendered.jpegData(compressionQuality: 0.85)
    }
}

extension KYCCamera: AVCaptureVideoDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        if target == .face {
            let request = VNDetectFaceRectanglesRequest()
            try? VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .leftMirrored, options: [:]).perform([request])
            let faces = (request.results ?? [])
            if let f = faces.max(by: { $0.boundingBox.area < $1.boundingBox.area }), faces.count == 1 {
                let b = f.boundingBox
                Task { @MainActor in self.evaluate(area: b.area, center: CGPoint(x: b.midX, y: b.midY)) }
            } else {
                Task { @MainActor in self.noTarget() }
            }
        } else {
            let request = VNDetectDocumentSegmentationRequest()
            try? VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .right, options: [:]).perform([request])
            if let doc = (request.results)?.first {
                let b = doc.boundingBox
                Task { @MainActor in self.evaluate(area: b.area, center: CGPoint(x: b.midX, y: b.midY)) }
            } else {
                Task { @MainActor in self.noTarget() }
            }
        }
    }
}

extension KYCCamera: AVCapturePhotoCaptureDelegate {
    nonisolated func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let data = photo.fileDataRepresentation()
        Task { @MainActor in
            self.capturing = false
            guard error == nil, let data, let jpeg = self.process(data) else {
                self.phase = .framing
                return
            }
            self.phase = .captured
            self.onCaptured?(jpeg)
        }
    }
}

private extension CGRect {
    var area: CGFloat { width * height }
}

/// 相机预览层（SwiftUI 包装）。
struct KYCCameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.videoPreviewLayer.session = session
        v.videoPreviewLayer.videoGravity = .resizeAspectFill
        return v
    }
    func updateUIView(_ uiView: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var videoPreviewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}
