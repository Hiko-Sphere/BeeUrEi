import SwiftUI
import ARKit
import UIKit
import AVFoundation
import CoreGraphics
import Vision

/// 取景识别：用相机 + YOLO 找最大目标，语音指引把它移到画面中央对准，对准后说出"这是什么"。
/// 解决竞品最弱的"盲人不知镜头对着哪"。决策逻辑在核心 `FramingGuide`（已测）。
@Observable
final class FramingAssistViewModel {
    private(set) var state: FrameSourceState = .idle
    private(set) var guidanceText = "正在启动…"
    private(set) var resultText = ""

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

    var arSession: ARSession { source.session }

    func start() {
        guard DeviceSupport.hasLiDAR else {
            state = .unsupported("识别功能需要带 LiDAR 的 iPhone。")
            guidanceText = "设备不支持"
            return
        }
        source.onStateChange = { [weak self] in self?.state = $0 }
        source.onFrame = { [weak self] frame in self?.handle(frame) }
        source.start()
    }

    func stop() { source.stop() }

    private func handle(_ frame: SensorFrame) {
        latestBuffer = frame.pixelBuffer // 供"朗读文字"用最新帧
        guard frame.timestamp - lastProcess >= 0.4 else { return }
        lastProcess = frame.timestamp

        // 全帧检测，取最大框作为取景目标。
        let detections = detector.detect(in: frame.pixelBuffer, regionOfInterest: CGRect(x: 0, y: 0, width: 1, height: 1))
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
        guard let buffer = latestBuffer else { speak("请先把要读的文字对准相机"); return }
        resultText = "正在识别文字…"
        let request = VNRecognizeTextRequest { [weak self] req, _ in
            let texts = (req.results as? [VNRecognizedTextObservation])?
                .compactMap { $0.topCandidates(1).first?.string } ?? []
            let joined = texts.joined(separator: " ")
            DispatchQueue.main.async {
                let out = joined.isEmpty ? "没有识别到文字" : joined
                self?.resultText = out
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

    private func speak(_ text: String) {
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
                    Spacer()
                    Button("完成") { onClose() }
                        .padding()
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding()
                }
                Spacer()
                Button { model.readText() } label: {
                    Label("朗读文字", systemImage: "text.viewfinder")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding(.bottom, 8)
                .accessibilityHint("识别并朗读相机里看到的文字")
                VStack(spacing: 8) {
                    Text(model.guidanceText).font(.title).bold()
                    if !model.resultText.isEmpty {
                        Text(model.resultText).font(.title2).foregroundStyle(.green)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(.ultraThinMaterial)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(model.resultText.isEmpty ? model.guidanceText : model.resultText)
            }
        }
        .task { model.start() }
        .onDisappear { model.stop() }
    }
}
