import SwiftUI
import ARKit
import UIKit
import AVFoundation
import CoreGraphics
import CoreVideo
import Vision

/// 触摸探索条目：物体框或文字行（定向图像空间，Vision 归一化、原点左下）。
struct ExploreItem: Identifiable {
    let id = UUID()
    let label: String
    let box: CGRect
    let isText: Bool
}

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
    @ObservationIgnored private var docMode = false        // 文档模式（整页取景引导+自动拍摄）
    @ObservationIgnored private var docStableFrames = 0    // 整页完整入画的连续帧数（≥2 自动拍摄）
    @ObservationIgnored private var docCapturing = false   // OCR 进行中，防重复拍摄

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

        // 文档模式（Seeing AI 式）：引导把整页放进画面，稳定后自动拍摄整页朗读。
        if docMode {
            documentGuidance(frame)
            return
        }
        // 找我的东西：教学/寻找两个阶段都接管帧流。
        if findPhase == .teaching { teachStep(frame); return }
        if findPhase == .finding { findStep(frame); return }

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

    // MARK: 找周围的物品（Lookout Find 式：通用类别寻找，复用 YOLO + 时钟方位 + LiDAR 距离）

    /// 可寻找的通用类别（COCO 标签 → 中文名）。只放当前模型真能检出的类别，避免"永远找不到"。
    static let findableCategories: [(label: String, name: String)] = [
        ("chair", "椅子"), ("couch", "沙发"), ("bed", "床"), ("dining table", "餐桌"),
        ("toilet", "马桶"), ("bottle", "瓶子"), ("cup", "杯子"), ("cell phone", "手机"), ("backpack", "背包"),
    ]
    @ObservationIgnored private var categoryTarget: (label: String, name: String)?

    /// 开始寻找一类通用物品（不需要先教，YOLO 直接认）。
    func startCategoryFind(label: String, name: String) {
        docMode = false
        findTarget = nil
        categoryTarget = (label, name)
        findPhase = .finding
        lastFindHit = 0
        lastFindHeartbeat = 0
        guidanceText = "寻找：\(name)"
        speak("开始找\(name)。拿着手机慢慢左右移动扫一圈，看到了我会报方位。")
    }

    /// 类别寻找帧：YOLO 命中类别即报方位与 LiDAR 距离（与"找我的东西"同节奏去抖）。
    private func categoryFindStep(_ frame: SensorFrame, category: (label: String, name: String)) {
        let dets = detector.detect(in: frame.pixelBuffer, regionOfInterest: CGRect(x: 0, y: 0, width: 1, height: 1))
        let hit = dets.filter { $0.label.lowercased() == category.label }
            .max { $0.confidence < $1.confidence }
        if let hit, let box = hit.box {
            guard frame.timestamp - lastFindHit >= 2.5 else { return } // 命中去抖
            lastFindHit = frame.timestamp
            let clock = ClockDirection(normalizedX: box.midX, horizontalFOVDegrees: 68)
            var distText = ""
            if let depth = frame.depth {
                let s = DepthSampling.samples(depth: depth.depth, confidence: depth.confidence,
                                              normalizedX: box.midX, normalizedY: box.midY)
                if let m = DepthSampler().nearestDistance(depths: s.depths, confidences: s.confidences) {
                    distText = String(format: "，大约%.1f米", m)
                }
            }
            let where_ = clock.hour == 12 ? "正前方" : "\(clock.hour)点钟方向"
            guidanceText = "\(category.name)：\(where_)"
            speak("\(category.name)，在\(where_)\(distText)")
        } else if frame.timestamp - lastFindHeartbeat >= 6 {
            lastFindHeartbeat = frame.timestamp
            speak("还在找\(category.name)，慢慢移动手机")
        }
    }

    // MARK: 找我的东西（Seeing AI Find My Things 式，端侧 FeaturePrint）

    enum FindPhase { case idle, teaching, finding }
    private(set) var findPhase: FindPhase = .idle
    private(set) var taughtItems: [String] = []
    var showTeachNaming = false // 拍满三张后弹命名输入
    @ObservationIgnored private var pendingPrints: [VNFeaturePrintObservation] = []
    @ObservationIgnored private var lastTeachShot: TimeInterval = 0
    @ObservationIgnored private var findTarget: (name: String, prints: [VNFeaturePrintObservation])?
    @ObservationIgnored private var lastFindHit: TimeInterval = 0
    @ObservationIgnored private var lastFindHeartbeat: TimeInterval = 0
    @ObservationIgnored private let itemsStore = TaughtItemsStore()
    /// 同物匹配阈值（FeaturePrint 距离，越小越像）。⚠️ 经验值，待真机按误报率微调。
    @ObservationIgnored private let matchThreshold: Float = 0.62

    func refreshTaughtItems() { taughtItems = itemsStore.names }

    /// 教学：把物品举在镜头前，每 ~1s 自动拍一张特征，共 3 张后请用户命名。
    func startTeaching() {
        docMode = false
        findPhase = .teaching
        pendingPrints = []
        lastTeachShot = 0
        guidanceText = "教我认东西：把物品举在镜头前"
        speak("教我认东西。把物品举在镜头前约三十厘米，慢慢转动它，我会自动拍三张。")
    }

    /// 拍满三张后由命名弹窗回调保存。
    func saveTaughtItem(named name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !pendingPrints.isEmpty else { findPhase = .idle; return }
        itemsStore.save(name: trimmed, prints: pendingPrints)
        pendingPrints = []
        findPhase = .idle
        refreshTaughtItems()
        guidanceText = "已学会：\(trimmed)"
        speak("学会了。以后可以让我帮你找\(trimmed)。")
    }

    func deleteTaughtItem(_ name: String) {
        itemsStore.delete(name: name)
        refreshTaughtItems()
    }

    /// 开始寻找某个已学物品。
    func startFinding(_ name: String) {
        let prints = itemsStore.prints(for: name)
        guard !prints.isEmpty else { speak("没有找到\(name)的学习记录"); return }
        docMode = false
        categoryTarget = nil
        findTarget = (name, prints)
        findPhase = .finding
        lastFindHit = 0
        lastFindHeartbeat = 0
        guidanceText = "寻找：\(name)"
        speak("开始找\(name)。拿着手机慢慢左右移动扫一圈，对到了我会告诉你方位。")
    }

    func stopFindFlow() {
        findPhase = .idle
        findTarget = nil
        categoryTarget = nil
        pendingPrints = []
        guidanceText = "已停止"
    }

    /// 教学帧：约 1s 自动拍一张中央区特征，三张后请命名。
    private func teachStep(_ frame: SensorFrame) {
        guard frame.timestamp - lastTeachShot >= 1.0 else { return }
        lastTeachShot = frame.timestamp
        // 中央 50% 区域：物品举在镜头前的主体区。
        guard let print = Self.featurePrint(in: frame.pixelBuffer,
                                            roi: CGRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5)) else { return }
        pendingPrints.append(print)
        speak("拍了第\(pendingPrints.count)张")
        guidanceText = "已拍 \(pendingPrints.count)/3"
        if pendingPrints.count >= 3 {
            findPhase = .idle
            showTeachNaming = true
            speak("拍好了。请输入这个东西的名字，可以用键盘上的话筒说出来。")
        }
    }

    /// 寻找帧：类别寻找走 YOLO 直认；个人物品走候选区特征距离比对，命中报方位与距离。
    private func findStep(_ frame: SensorFrame) {
        if let category = categoryTarget { categoryFindStep(frame, category: category); return }
        guard let target = findTarget else { return }
        // 候选区：YOLO 框（最多 3 个）+ 中央区兜底（YOLO 认不出"钥匙串"这类小物）。
        var rois: [CGRect] = [CGRect(x: 0.3, y: 0.3, width: 0.4, height: 0.4)]
        let dets = detector.detect(in: frame.pixelBuffer, regionOfInterest: CGRect(x: 0, y: 0, width: 1, height: 1))
        for d in dets.prefix(3) {
            if let b = d.box { rois.append(CGRect(x: b.x, y: b.y, width: b.width, height: b.height)) }
        }
        var best: (dist: Float, roi: CGRect)?
        for roi in rois {
            guard let print = Self.featurePrint(in: frame.pixelBuffer, roi: roi) else { continue }
            for taught in target.prints {
                var d: Float = .greatestFiniteMagnitude
                guard (try? print.computeDistance(&d, to: taught)) != nil else { continue }
                if best == nil || d < best!.dist { best = (d, roi) }
            }
        }
        if let best, best.dist < matchThreshold {
            guard frame.timestamp - lastFindHit >= 2.5 else { return } // 命中去抖
            lastFindHit = frame.timestamp
            let clock = ClockDirection(normalizedX: best.roi.midX, horizontalFOVDegrees: 68)
            // 距离：用候选区中心的 LiDAR 深度（有就报，没有只报方向）。
            var distText = ""
            if let depth = frame.depth {
                let s = DepthSampling.samples(depth: depth.depth, confidence: depth.confidence,
                                              normalizedX: best.roi.midX, normalizedY: best.roi.midY)
                if let m = DepthSampler().nearestDistance(depths: s.depths, confidences: s.confidences) {
                    distText = String(format: "，大约%.1f米", m)
                }
            }
            let where_ = clock.hour == 12 ? "正前方" : "\(clock.hour)点钟方向"
            guidanceText = "可能找到\(target.name)：\(where_)"
            speak("可能是\(target.name)，在\(where_)\(distText)")
        } else if frame.timestamp - lastFindHeartbeat >= 6 {
            lastFindHeartbeat = frame.timestamp
            speak("还在找，慢慢移动手机")
        }
    }

    /// 计算特征指纹（可限定归一化 ROI，Vision 原点左下）。
    private static func featurePrint(in buffer: CVPixelBuffer, roi: CGRect?) -> VNFeaturePrintObservation? {
        let request = VNGenerateImageFeaturePrintRequest()
        if let roi { request.regionOfInterest = roi }
        try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([request])
        return request.results?.first
    }

    // MARK: 触摸探索（Seeing AI 式：手指划到哪读哪）

    private(set) var exploreImage: UIImage?
    private(set) var exploreItems: [ExploreItem] = []
    var exploring = false

    /// 定格当前画面 → YOLO+OCR 全帧分析 → 进入触摸探索。
    /// 帧先旋转为竖屏 upright，检测/OCR/显示共用**同一**定向空间——触摸↔框映射天然自洽，无方向坑。
    func captureExplore() {
        guard let live = latestBuffer, !exploring, !paused else { return }
        speak("正在分析画面")
        guard let oriented = Self.orientedBuffer(from: live) else { speak("分析失败，请重试"); return }
        // 物体（YOLO 全帧，中文名）。
        let dets = detector.detect(in: oriented.buffer, regionOfInterest: CGRect(x: 0, y: 0, width: 1, height: 1))
        let objectItems: [ExploreItem] = dets.compactMap { d in
            guard let b = d.box else { return nil }
            return ExploreItem(label: labels.localizedName(d.label),
                               box: CGRect(x: b.x, y: b.y, width: b.width, height: b.height), isText: false)
        }
        // 文字行（OCR fast：探索场景求响应）。
        let request = VNRecognizeTextRequest { [weak self] req, _ in
            let obs = (req.results as? [VNRecognizedTextObservation]) ?? []
            let textItems: [ExploreItem] = obs.compactMap { o in
                guard let s = o.topCandidates(1).first?.string, !s.isEmpty else { return nil }
                return ExploreItem(label: s, box: o.boundingBox, isText: true)
            }
            DispatchQueue.main.async {
                guard let self, !self.paused else { return }
                self.exploreItems = objectItems + textItems
                self.exploreImage = UIImage(cgImage: oriented.cgImage)
                self.exploring = true
                self.speak("触摸探索。手指在屏幕上滑动，碰到什么读什么。共\(objectItems.count)个物体、\(textItems.count)段文字。")
            }
        }
        request.recognitionLevel = .fast
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cgImage: oriented.cgImage, options: [:]).perform([request])
        }
    }

    func exitExplore() {
        exploring = false
        exploreImage = nil
        exploreItems = []
    }

    /// 探索命中：归一化点（Vision 系，原点左下）→ 重叠时取**最小面积**框（具体物胜过背景大框）。
    func exploreHit(atNormalized p: CGPoint) -> String? {
        let hits = exploreItems.filter { $0.box.insetBy(dx: -0.01, dy: -0.01).contains(p) }
        return hits.min(by: { $0.box.width * $0.box.height < $1.box.width * $1.box.height })?.label
    }

    /// 探索朗读（去重由画布管理）。
    func speakExplore(_ text: String) { speak(text) }

    /// ARKit 横向帧 → 竖屏 upright 的 CGImage + 同向 CVPixelBuffer。
    private static func orientedBuffer(from src: CVPixelBuffer) -> (cgImage: CGImage, buffer: CVPixelBuffer)? {
        let ci = CIImage(cvPixelBuffer: src).oriented(.right)
        let ctx = CIContext()
        guard let cg = ctx.createCGImage(ci, from: ci.extent) else { return nil }
        var out: CVPixelBuffer?
        let attrs: [CFString: Any] = [kCVPixelBufferCGImageCompatibilityKey: true,
                                      kCVPixelBufferCGBitmapContextCompatibilityKey: true]
        CVPixelBufferCreate(kCFAllocatorDefault, cg.width, cg.height, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &out)
        guard let buffer = out else { return nil }
        ctx.render(ci, to: buffer)
        return (cg, buffer)
    }

    // MARK: 文档模式（Seeing AI 式整页朗读）

    /// 进入/退出「读整页」：语音引导把整页放进画面，连续 2 帧完整入画即自动拍摄并按版面顺序朗读。
    func toggleDocumentMode() {
        docMode.toggle()
        docStableFrames = 0
        docCapturing = false
        if docMode {
            resultText = ""
            copyableResult = nil
            guidanceText = "读整页：把整页纸放进画面"
            speak("读整页模式。把手机举在纸张上方约三十厘米，听提示调整，对好后会自动拍摄并朗读全文。")
        } else {
            guidanceText = "已退出读整页"
            speak("已退出读整页")
        }
    }

    /// 文档取景引导：页面分割检测 → 边缘出画/太小提示 → 稳定自动拍摄。
    private func documentGuidance(_ frame: SensorFrame) {
        guard !docCapturing else { return }
        let request = VNDetectDocumentSegmentationRequest()
        try? VNImageRequestHandler(cvPixelBuffer: frame.pixelBuffer, options: [:]).perform([request])
        guard let doc = request.results?.first, doc.confidence > 0.5 else {
            docStableFrames = 0
            docHint("没有找到纸张，请把整页纸放进画面", at: frame.timestamp)
            return
        }
        let box = doc.boundingBox // 归一化坐标
        let m: CGFloat = 0.02
        let touchesEdge = box.minX < m || box.maxX > 1 - m || box.minY < m || box.maxY > 1 - m
        let area = box.width * box.height
        // 方向词在相机旋转下易说反，统一用"拿远/靠近"这类无方向提示（稳妥且对盲人更可执行）。
        if touchesEdge {
            docStableFrames = 0
            docHint("纸张边缘超出画面，请拿远一点并居中", at: frame.timestamp)
            return
        }
        if area < 0.18 {
            docStableFrames = 0
            docHint("靠近一点", at: frame.timestamp)
            return
        }
        docStableFrames += 1
        guidanceText = "对准了，保持不动…"
        if docStableFrames >= 2 {
            docCapturing = true
            speak("拍好了，正在识别整页")
            guidanceText = "正在识别整页…"
            captureDocument(frame.pixelBuffer)
        }
    }

    /// 文档引导提示：去重 + 2.5s 节流，避免连环重复念。
    private func docHint(_ text: String, at now: TimeInterval) {
        guidanceText = text
        if text != lastHint || now - lastSpoke >= 2.5 {
            lastHint = text
            lastSpoke = now
            speak(text)
        }
    }

    /// 拍摄整页：深拷贝当前帧 → 精确 OCR → 按版面顺序（自上而下、同行从左到右）朗读全文。
    private func captureDocument(_ live: CVPixelBuffer) {
        guard let buffer = copyPixelBuffer(live) else {
            docCapturing = false
            speak("拍摄失败，请重试")
            return
        }
        let request = VNRecognizeTextRequest { [weak self] req, _ in
            let obs = (req.results as? [VNRecognizedTextObservation]) ?? []
            // 版面顺序：bbox 原点在左下 → midY 大者在上；同一行（纵向重叠）按 minX 从左到右。
            let sorted = obs.sorted { a, b in
                let ba = a.boundingBox, bb = b.boundingBox
                if abs(ba.midY - bb.midY) > min(ba.height, bb.height) * 0.6 { return ba.midY > bb.midY }
                return ba.minX < bb.minX
            }
            let lines = sorted.compactMap { $0.topCandidates(1).first?.string }
            DispatchQueue.main.async {
                guard let self else { return }
                self.docCapturing = false
                self.docMode = false
                if lines.isEmpty {
                    self.resultText = "没有识别到文字"
                    self.guidanceText = "没有识别到文字，请再试一次"
                    self.speak("没有识别到文字，请再点一次读整页重试")
                } else {
                    let full = lines.joined(separator: "\n")
                    self.resultText = "整页：\(lines.first ?? "")…"
                    self.copyableResult = full
                    self.guidanceText = "识别完成，共 \(lines.count) 行"
                    self.speak("识别完成。" + lines.joined(separator: "。"))
                }
            }
        }
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = true
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([request])
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
                guard let self else { return }
                guard let first = payloads.first else {
                    self.resultText = ""
                    self.copyableResult = nil
                    self.speak("没有识别到二维码或条码")
                    return
                }
                self.copyableResult = first
                // 先说"这是什么类型"再读内容（核心 BarcodePayload，已测）；商品条码走本地商品库。
                switch BarcodePayload.classify(first) {
                case .productCode:
                    if let name = self.productStore.name(for: first) {
                        self.resultText = "商品：\(name)"
                        self.speak("这是\(name)")
                    } else {
                        self.resultText = "商品条码：\(first)"
                        self.pendingProductCode = first
                        self.showProductNaming = true
                        self.speak("是商品条码，我还不认识它。给它起个名字，下次扫到我直接报名字。")
                    }
                case .wifi(let ssid):
                    self.resultText = "无线网络码" + (ssid.map { "：\($0)" } ?? "")
                    self.speak("是无线网络配置码" + (ssid.map { "，网络名称\($0)" } ?? ""))
                case .url(let host):
                    self.resultText = "网址：\(first)"
                    self.speak("是一个网址" + (host.map { "，网站是\($0)" } ?? "") + "，内容已可复制")
                case .phone(let number):
                    self.resultText = "电话：\(number)"
                    self.speak("是电话号码：\(number)")
                case .contact:
                    self.resultText = "名片码"
                    self.speak("是一张电子名片，内容已可复制")
                case .text:
                    self.resultText = "码内容：\(first)"
                    self.speak("识别到：\(first)")
                }
            }
        }
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([request])
        }
    }

    // MARK: 扫码认商品（Seeing AI Products 频道的隐私版：本地商品库，扫一次自己命名）

    @ObservationIgnored private let productStore = ProductMemoryStore()
    @ObservationIgnored private var pendingProductCode: String?
    var showProductNaming = false // 扫到陌生商品条码后弹命名输入

    /// 给刚扫到的陌生商品条码命名（存本地商品库，下次扫到直接报名字）。
    func saveProductName(_ name: String) {
        guard let code = pendingProductCode else { return }
        pendingProductCode = nil
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        productStore.save(barcode: code, name: trimmed)
        resultText = "已记住：\(trimmed)"
        speak("记住了。下次扫到这个条码我会直接说\(trimmed)。")
    }

    /// 识别人民币纸币面额（端侧 OCR 角号/大写 + 票面主色，核心 CurrencyClassifier，已测）。
    /// 低置信只说"可能"，并提醒换角度确认——识币错了是真金白银，宁可多让用户拍一次。
    func readCurrency() {
        guard let live = latestBuffer else { speak("请把纸币平整地对准相机"); return }
        if tooDarkToProceed() { return }
        guard let buffer = copyPixelBuffer(live) else { speak("识别失败，请重试"); return } // 深拷贝供异步安全读
        resultText = "正在识别纸币…"
        let rgb = ColorSampler.averageRGB(in: buffer, rect: CGRect(x: 0.3, y: 0.3, width: 0.4, height: 0.4))
        let request = VNRecognizeTextRequest { [weak self] req, _ in
            let texts = (req.results as? [VNRecognizedTextObservation])?
                .compactMap { $0.topCandidates(1).first?.string } ?? []
            let result = CurrencyClassifier().classify(texts: texts, rgb: rgb)
            DispatchQueue.main.async {
                guard let self else { return }
                self.copyableResult = nil
                if let result {
                    let name = Self.yuanName(result.denomination)
                    self.resultText = "纸币：\(name)"
                    self.speak(result.confident ? name : "可能是\(name)，请换个角度再拍一次确认")
                } else {
                    self.resultText = ""
                    self.speak("没认出纸币面额。请把纸币平整地举在镜头前约三十厘米再试")
                }
            }
        }
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([request])
        }
    }

    private static func yuanName(_ d: Int) -> String {
        switch d {
        case 100: return "一百元"
        case 50: return "五十元"
        case 20: return "二十元"
        case 10: return "十元"
        case 5: return "五元"
        default: return "一元"
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
    @State private var showFindMenu = false
    @State private var teachName = ""
    @State private var productName = ""
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
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
                // 主操作：与主页磁贴同语言（蜂蜜大按钮），相机画面上始终清晰。
                BeeBigButton("前方有什么", systemImage: "eye.fill",
                             subtitle: "汇总播报识别到的物体", tint: .beeHoney) {
                    model.describeScene()
                }
                .padding(.horizontal)
                .accessibilityHint("汇总播报前方识别到的物体")

                HStack(spacing: BeeSpacing.sm) {
                    overlayAction("朗读文字", systemImage: "text.viewfinder",
                                  hint: "识别并朗读相机里看到的文字") { model.readText() }
                    overlayAction("读整页", systemImage: "doc.text.viewfinder",
                                  hint: "引导你把整页纸放进画面，自动拍摄并按顺序朗读全文") { model.toggleDocumentMode() }
                }
                .padding(.horizontal)
                HStack(spacing: BeeSpacing.sm) {
                    overlayAction("识别颜色", systemImage: "paintpalette.fill",
                                  hint: "说出画面中央的颜色") { model.readColor() }
                    overlayAction("扫码", systemImage: "qrcode.viewfinder",
                                  hint: "识别并朗读二维码或条码的内容") { model.readBarcode() }
                    overlayAction("触摸探索", systemImage: "hand.draw.fill",
                                  hint: "定格画面后，手指滑到哪里就朗读那里的物体或文字") { model.captureExplore() }
                }
                .padding(.horizontal)
                HStack(spacing: BeeSpacing.sm) {
                    overlayAction("识别纸币", systemImage: "banknote.fill",
                                  hint: "识别人民币纸币的面额") { model.readCurrency() }
                    overlayAction(model.findPhase == .idle ? "找东西" : "停止寻找",
                                  systemImage: model.findPhase == .idle ? "magnifyingglass" : "stop.circle.fill",
                                  hint: "教 App 认你自己的钥匙、水杯等，或寻找周围的椅子、瓶子等物品") {
                        if model.findPhase == .idle { showFindMenu = true } else { model.stopFindFlow() }
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 8)

                VStack(spacing: 8) {
                    // 仅把两段纯文本合并朗读；可交互的「复制内容」按钮放在合并元素之外，
                    // 否则 .combine 会吞掉按钮的可聚焦性与激活动作、且不念出"复制内容"（见无障碍审计）。
                    VStack(spacing: 8) {
                        Text(model.guidanceText).font(.title).bold().foregroundStyle(.white)
                        if !model.resultText.isEmpty {
                            Text(model.resultText).font(.title2).foregroundStyle(Color.beeHoney)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(model.resultText.isEmpty ? model.guidanceText : model.resultText)
                    .accessibilityAddTraits(.updatesFrequently)

                    if let copyable = model.copyableResult {
                        Button("复制内容") { UIPasteboard.general.string = copyable }
                            .buttonStyle(.bordered).tint(.white)
                            .accessibilityHint("把识别到的文字或码内容复制到剪贴板")
                    }
                }
                .padding()
                .frame(maxWidth: .infinity)
                // 实底深色结果条：相机画面上白字/蜂蜜字恒高对比（材质会透出画面）。
                .background(Color.beeInk.opacity(reduceTransparency ? 1 : 0.88))
            }
        }
        .task { model.start(); model.refreshTaughtItems() }
        .onDisappear { model.stop(); Torch.set(false) }
        // 找东西：先列已教的个人物品，再列通用类别（Lookout Find 式），最后教新物品。
        .confirmationDialog("找东西", isPresented: $showFindMenu, titleVisibility: .visible) {
            ForEach(model.taughtItems, id: \.self) { item in
                Button("找：\(item)") { model.startFinding(item) }
            }
            ForEach(FramingAssistViewModel.findableCategories, id: \.label) { c in
                Button("找周围的\(c.name)") { model.startCategoryFind(label: c.label, name: c.name) }
            }
            Button("教我认一个新东西") { model.startTeaching() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("个人物品先「教我认一个新东西」拍三张；椅子、瓶子这类通用物品不用教，直接找。")
        }
        // 扫到陌生商品条码：起名字存本地商品库（键盘话筒可语音输入）。
        .alert("给这个商品起个名字", isPresented: Binding(get: { model.showProductNaming },
                                                          set: { model.showProductNaming = $0 })) {
            TextField("如：牛奶、感冒药", text: $productName)
            Button("保存") { model.saveProductName(productName); productName = "" }
            Button("取消", role: .cancel) { productName = "" }
        } message: {
            Text("下次扫到同一条码会直接报这个名字。可以点键盘上的话筒用语音输入。")
        }
        // 教学拍满三张：命名（键盘话筒可语音输入）。
        .alert("给它起个名字", isPresented: Binding(get: { model.showTeachNaming },
                                                    set: { model.showTeachNaming = $0 })) {
            TextField("如：家门钥匙", text: $teachName)
            Button("保存") { model.saveTaughtItem(named: teachName); teachName = "" }
            Button("取消", role: .cancel) { teachName = ""; model.stopFindFlow() }
        } message: {
            Text("可以点键盘上的话筒用语音说出名字。")
        }
        // 触摸探索：定格画面全屏呈现，手指划到哪读哪（Seeing AI 式）。
        .fullScreenCover(isPresented: Binding(get: { model.exploring },
                                              set: { if !$0 { model.exitExplore() } })) {
            ExploreCanvas(model: model) { model.exitExplore() }
        }
    }

    /// 相机浮层的次级操作（深底白字+蜂蜜图标，与主页磁贴一致）。
    private func overlayAction(_ title: String, systemImage: String, hint: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: systemImage).font(.title3.weight(.semibold)).foregroundStyle(Color.beeHoney)
                Text(title).font(.footnote.weight(.semibold)).foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity, minHeight: 64)
            .background(Color.beeInk.opacity(reduceTransparency ? 1 : 0.88),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(.white.opacity(0.10), lineWidth: 0.5))
        }
        .buttonStyle(BeePressStyle())
        .accessibilityLabel(title)
        .accessibilityHint(hint)
    }
}

/// 触摸探索画布（Seeing AI 式）：显示定格画面，手指滑到哪个物体/文字就朗读哪个。
/// VoiceOver 下用 .allowsDirectInteraction 让拖动直达画布（标准探索式交互做法）。
private struct ExploreCanvas: View {
    let model: FramingAssistViewModel
    let onClose: () -> Void
    @State private var lastSpoken = ""

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.ignoresSafeArea()
            if let img = model.exploreImage {
                GeometryReader { geo in
                    let fit = Self.fittedRect(imageSize: img.size, in: geo.size)
                    Image(uiImage: img)
                        .resizable().scaledToFit()
                        .frame(width: geo.size.width, height: geo.size.height)
                        .contentShape(Rectangle())
                        .gesture(
                            DragGesture(minimumDistance: 0).onChanged { v in
                                let p = v.location
                                guard fit.contains(p), fit.width > 0, fit.height > 0 else { return }
                                // 屏幕点 → 定向图像归一化（Vision 原点左下）。
                                let nx = (p.x - fit.minX) / fit.width
                                let ny = 1 - (p.y - fit.minY) / fit.height
                                if let label = model.exploreHit(atNormalized: CGPoint(x: nx, y: ny)),
                                   label != lastSpoken {
                                    lastSpoken = label
                                    model.speakExplore(label)
                                }
                            }
                        )
                        .accessibilityElement()
                        .accessibilityLabel("触摸探索画布。手指在屏幕上滑动，碰到物体或文字会朗读。")
                        .accessibilityAddTraits(.allowsDirectInteraction)
                }
            }
            BeeBigButton("完成", systemImage: "checkmark.circle.fill", tint: .beeHoney) { onClose() }
                .padding(.horizontal, BeeSpacing.lg)
                .padding(.bottom, BeeSpacing.lg)
        }
    }

    /// aspect-fit 后图像在容器内的实际显示矩形（用于触摸→图像坐标映射）。
    static func fittedRect(imageSize: CGSize, in container: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0 else { return .zero }
        let scale = min(container.width / imageSize.width, container.height / imageSize.height)
        let w = imageSize.width * scale, h = imageSize.height * scale
        return CGRect(x: (container.width - w) / 2, y: (container.height - h) / 2, width: w, height: h)
    }
}
