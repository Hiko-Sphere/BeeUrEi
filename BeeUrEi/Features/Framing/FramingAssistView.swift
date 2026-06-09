import SwiftUI
import ARKit
import UIKit
import AVFoundation
import CoreGraphics
import CoreVideo
import Vision

/// 取景识别：用相机 + YOLO 找最大目标，语音指引把它移到画面中央对准，对准后说出"这是什么"。
/// 解决竞品最弱的"盲人不知镜头对着哪"。决策逻辑在核心 `FramingGuide`（已测）。
@Observable
final class FramingAssistViewModel {
    private(set) var state: FrameSourceState = .idle
    private(set) var guidanceText = "正在启动…"
    private(set) var resultText = ""
    private(set) var copyableResult: String?   // OCR/扫码的原始内容，可复制

    @ObservationIgnored private let source = ARDepthCameraSource()
    @ObservationIgnored private let detector: ObstacleDetecting = {
        let yolo = YOLOObstacleDetector()
        return yolo.isAvailable ? yolo : StubObstacleDetector()
    }()
    @ObservationIgnored private let labels = LabelCatalog()
    @ObservationIgnored private let framing = FramingGuide()
    @ObservationIgnored private let synth = AVSpeechSynthesizer()
    @ObservationIgnored private var lastProcess: TimeInterval = 0
    @ObservationIgnored private var lastSpoke: TimeInterval = 0
    @ObservationIgnored private var lastHint = ""
    @ObservationIgnored private var centeredFrames = 0
    @ObservationIgnored private var latestBuffer: CVPixelBuffer?
    @ObservationIgnored private var latestDetections: [DetectedObject] = []
    @ObservationIgnored private var paused = false // 关闭/被来电盖上后：停止播报并丢弃在途帧/异步识别结果

    var arSession: ARSession { source.session }

    func start() {
        guard DeviceSupport.hasLiDAR else {
            state = .unsupported("识别功能需要带 LiDAR 的 iPhone。")
            guidanceText = "设备不支持"
            return
        }
        paused = false
        source.onStateChange = { [weak self] in self?.state = $0 }
        source.onFrame = { [weak self] frame in self?.handle(frame) }
        source.start()
    }

    func stop() {
        paused = true
        source.stop()
        synth.stopSpeaking(at: .immediate) // 关闭/被来电盖上时立刻闭嘴，避免识别播报串入通话
    }

    private func handle(_ frame: SensorFrame) {
        guard !paused else { return } // 暂停后丢弃在途帧
        latestBuffer = frame.pixelBuffer // 供"朗读文字"用最新帧
        guard frame.timestamp - lastProcess >= 0.4 else { return }
        lastProcess = frame.timestamp

        // 全帧检测，取最大框作为取景目标。
        let detections = detector.detect(in: frame.pixelBuffer, regionOfInterest: CGRect(x: 0, y: 0, width: 1, height: 1))
        latestDetections = detections // 供"前方有什么"概述
        let target = detections
            .compactMap { d -> (object: DetectedObject, box: NormalizedBox)? in d.box.map { (d, $0) } }
            .max { $0.box.width * $0.box.height < $1.box.width * $1.box.height }

        let guidance = framing.guide(target: target?.box)
        let hint = framing.hint(guidance)
        guidanceText = hint

        if guidance == .centered, let target {
            centeredFrames += 1
            if centeredFrames >= 2 {
                let name = labels.localizedName(target.object.label)
                resultText = "识别到：\(name)"
                speak("这是\(name)")
                lastSpoke = frame.timestamp // 防止下一非居中帧立刻打断"这是X"重复方向播报（见审查 #4）
                centeredFrames = 0
            }
        } else {
            centeredFrames = 0
            if hint != lastHint || frame.timestamp - lastSpoke >= 2 {
                lastHint = hint
                lastSpoke = frame.timestamp
                speak(hint)
            }
        }
    }

    /// 朗读相机里看到的文字（端侧 Vision OCR，中英文）——盲人读标牌/标签/菜单。
    func readText() {
        guard let live = latestBuffer else { speak("请先把要读的文字对准相机"); return }
        if tooDarkToProceed() { return }
        guard let buffer = copyPixelBuffer(live) else { speak("识别失败，请重试"); return } // 深拷贝供异步安全读
        resultText = "正在识别文字…"
        let request = VNRecognizeTextRequest { [weak self] req, _ in
            let texts = (req.results as? [VNRecognizedTextObservation])?
                .compactMap { $0.topCandidates(1).first?.string } ?? []
            let joined = texts.joined(separator: " ")
            DispatchQueue.main.async {
                let out = joined.isEmpty ? "没有识别到文字" : joined
                self?.resultText = out
                self?.copyableResult = joined.isEmpty ? nil : joined
                self?.speak(out)
            }
        }
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([request])
        }
    }

    /// "前方有什么"：把最近一帧的检测物体按左/中/右汇总播报（核心 SceneSummarizer，已测）。
    func describeScene() {
        if tooDarkToProceed() { return }
        let objects = latestDetections.map { (label: labels.localizedName($0.label), normalizedX: $0.normalizedX) }
        let text = SceneSummarizer().summary(objects: objects)
        resultText = text
        copyableResult = nil
        speak(text)
    }

    /// 识别二维码/条码并朗读内容（端侧 Vision）——读 QR 海报、产品码、WiFi 码等。
    func readBarcode() {
        guard let live = latestBuffer else { speak("请把二维码或条码对准相机"); return }
        if tooDarkToProceed() { return }
        guard let buffer = copyPixelBuffer(live) else { speak("识别失败，请重试"); return } // 深拷贝供异步安全读
        resultText = "正在扫码…"
        let request = VNDetectBarcodesRequest { [weak self] req, _ in
            let payloads = (req.results as? [VNBarcodeObservation])?.compactMap { $0.payloadStringValue } ?? []
            DispatchQueue.main.async {
                if let first = payloads.first {
                    self?.resultText = "码内容：\(first)"
                    self?.copyableResult = first
                    self?.speak("识别到：\(first)")
                } else {
                    self?.resultText = ""
                    self?.copyableResult = nil
                    self?.speak("没有识别到二维码或条码")
                }
            }
        }
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([request])
        }
    }

    /// 识别画面中央区域的颜色（端侧采样 + 核心 ColorNamer，已测）。
    func readColor() {
        guard let buffer = latestBuffer else { speak("请先把物体对准相机"); return }
        if tooDarkToProceed() { return }
        let rect = CGRect(x: 0.4, y: 0.4, width: 0.2, height: 0.2)
        if let rgb = ColorSampler.averageRGB(in: buffer, rect: rect) {
            let name = ColorNamer().name(r: rgb.r, g: rgb.g, b: rgb.b)
            resultText = "颜色：\(name)"
            copyableResult = nil
            speak("中间的颜色大概是\(name)")
        } else {
            speak("无法识别颜色")
        }
    }

    /// 深拷贝相机帧——`latestBuffer` 是 ARKit 内部缓冲池里的 capturedImage，ARKit 后续帧会回收/覆盖它；
    /// 异步(OCR/扫码 perform 在 global 队列、耗时数十~数百 ms)读它会读到撕裂/脏帧甚至 UB。
    /// 故对要异步处理的画面先逐平面深拷贝一份独立内存（见审查：use-after-recycle）。
    private func copyPixelBuffer(_ src: CVPixelBuffer) -> CVPixelBuffer? {
        CVPixelBufferLockBaseAddress(src, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(src, .readOnly) }
        let width = CVPixelBufferGetWidth(src)
        let height = CVPixelBufferGetHeight(src)
        let format = CVPixelBufferGetPixelFormatType(src)
        var dst: CVPixelBuffer?
        let attrs: [CFString: Any] = [kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary]
        guard CVPixelBufferCreate(kCFAllocatorDefault, width, height, format, attrs as CFDictionary, &dst) == kCVReturnSuccess,
              let dst else { return nil }
        CVPixelBufferLockBaseAddress(dst, [])
        defer { CVPixelBufferUnlockBaseAddress(dst, []) }
        let planeCount = CVPixelBufferGetPlaneCount(src)
        if planeCount == 0 {
            if let s = CVPixelBufferGetBaseAddress(src), let d = CVPixelBufferGetBaseAddress(dst) {
                let sb = CVPixelBufferGetBytesPerRow(src), db = CVPixelBufferGetBytesPerRow(dst)
                for row in 0..<height { memcpy(d.advanced(by: row * db), s.advanced(by: row * sb), min(sb, db)) }
            }
        } else {
            for plane in 0..<planeCount {
                guard let s = CVPixelBufferGetBaseAddressOfPlane(src, plane),
                      let d = CVPixelBufferGetBaseAddressOfPlane(dst, plane) else { continue }
                let sb = CVPixelBufferGetBytesPerRowOfPlane(src, plane), db = CVPixelBufferGetBytesPerRowOfPlane(dst, plane)
                let h = CVPixelBufferGetHeightOfPlane(src, plane)
                for row in 0..<h { memcpy(d.advanced(by: row * db), s.advanced(by: row * sb), min(sb, db)) }
            }
        }
        return dst
    }

    private func currentBrightness() -> Double? {
        guard let buffer = latestBuffer,
              let rgb = ColorSampler.averageRGB(in: buffer, rect: CGRect(x: 0, y: 0, width: 1, height: 1)) else { return nil }
        return LightMeter.luminance(r: rgb.r, g: rgb.g, b: rgb.b)
    }

    /// 太暗则播报提示并返回 true（识别/OCR 在暗处会失败，先提醒）。
    private func tooDarkToProceed() -> Bool {
        if let b = currentBrightness(), LightMeter().level(brightness: b) == .dark {
            speak("光线太暗，可能看不清，请到亮一点的地方再试")
            return true
        }
        return false
    }

    private func speak(_ text: String) {
        guard !paused else { return } // 已暂停(关闭/来电)：异步识别回调到达也不再播报
        if UIAccessibility.isVoiceOverRunning {
            UIAccessibility.post(notification: .announcement, argument: text)
            return
        }
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        u.rate = AVSpeechUtteranceMinimumSpeechRate
            + (AVSpeechUtteranceMaximumSpeechRate - AVSpeechUtteranceMinimumSpeechRate) * FeatureSettings().speechRate
        synth.stopSpeaking(at: .immediate)
        synth.speak(u)
    }
}

struct FramingAssistView: View {
    @State private var model = FramingAssistViewModel()
    @State private var torchOn = false
    let onClose: () -> Void

    var body: some View {
        ZStack {
            if case .running = model.state {
                ARSessionPreviewView(session: model.arSession)
                    .ignoresSafeArea()
                    .accessibilityHidden(true)
            } else {
                Color.black.ignoresSafeArea()
            }
            VStack {
                HStack {
                    Button { torchOn.toggle(); Torch.set(torchOn) } label: {
                        Image(systemName: torchOn ? "flashlight.on.fill" : "flashlight.off.fill")
                            .font(.title2)
                            .padding()
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .accessibilityLabel(torchOn ? "关闭手电筒" : "打开手电筒")
                    .padding(.leading)
                    Spacer()
                    Button("完成") { onClose() }
                        .padding()
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding()
                }
                Spacer()
                Button { model.describeScene() } label: {
                    Label("前方有什么", systemImage: "eye.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding(.horizontal)
                .accessibilityHint("汇总播报前方识别到的物体")
                HStack {
                    Button { model.readText() } label: {
                        Label("朗读文字", systemImage: "text.viewfinder")
                    }
                    .accessibilityHint("识别并朗读相机里看到的文字")
                    Button { model.readColor() } label: {
                        Label("识别颜色", systemImage: "paintpalette.fill")
                    }
                    .accessibilityHint("说出画面中央的颜色")
                    Button { model.readBarcode() } label: {
                        Label("扫码", systemImage: "qrcode.viewfinder")
                    }
                    .accessibilityHint("识别并朗读二维码或条码的内容")
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .padding(.bottom, 8)
                VStack(spacing: 8) {
                    // 仅把两段纯文本合并朗读；可交互的「复制内容」按钮放在合并元素之外，
                    // 否则 .combine 会吞掉按钮的可聚焦性与激活动作、且不念出"复制内容"（见无障碍审计）。
                    VStack(spacing: 8) {
                        Text(model.guidanceText).font(.title).bold()
                        if !model.resultText.isEmpty {
                            Text(model.resultText).font(.title2).foregroundStyle(Color.beeSuccess)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(model.resultText.isEmpty ? model.guidanceText : model.resultText)

                    if let copyable = model.copyableResult {
                        Button("复制内容") { UIPasteboard.general.string = copyable }
                            .buttonStyle(.bordered)
                            .accessibilityHint("把识别到的文字或码内容复制到剪贴板")
                    }
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(.ultraThinMaterial)
            }
        }
        .task { model.start() }
        .onDisappear { model.stop(); Torch.set(false) }
    }
}
