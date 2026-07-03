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
    private(set) var guidanceText = FramingStrings.starting(FeatureSettings().language)
    private(set) var resultText = ""
    private(set) var copyableResult: String?   // OCR/扫码的原始内容，可复制

    @ObservationIgnored private let source = ARDepthCameraSource()
    // 真实 YOLO 检测器；模型缺失时自身返回空（识别为空、不崩溃），无需占位实现。
    @ObservationIgnored private let detector: ObstacleDetecting = YOLOObstacleDetector()
    // 识别屏全量中英双语（E5）：播报语言/标签/OCR 语言/TTS 嗓音都跟随 App 语言设置（进屏时解析）。
    // View 的静态文案也读它（private(set)），保持同一语言真相来源。
    @ObservationIgnored private(set) var lang: Language = FeatureSettings().language
    @ObservationIgnored private var labels = LabelCatalog(language: FeatureSettings().language)
    @ObservationIgnored private let framing = FramingGuide()
    @ObservationIgnored private var lastProcess: TimeInterval = 0
    /// 取景/文档提示节流（核心，已测）：新提示须连续两个处理帧稳定 + 距上次播报 ≥1.2s 才开口，
    /// 修"稍微移动一点点，正在报的内容立刻被下一帧内容掐断"。
    @ObservationIgnored private var hintThrottle = HintThrottle()
    @ObservationIgnored private var centeredFrames = 0
    /// 持续居中防复读：记录已播报的目标标签，目标移出中央或换了目标才允许重报（否则每 ~0.8s 重复"这是X"）。
    @ObservationIgnored private var centeredSpokenLabel: String?
    @ObservationIgnored private var latestBuffer: CVPixelBuffer?
    @ObservationIgnored private var latestDepth: DepthMap?
    @ObservationIgnored private var latestCamera: CameraGeometry?
    @ObservationIgnored private var latestDetections: [DetectedObject] = []

    /// 真实水平视场角（有内参时计算，否则回退 68° 经验值）。
    private var currentFOV: Double {
        guard let c = latestCamera else { return 68 }
        return CameraFOV.horizontalDegrees(fx: c.intrinsics.fx, imageWidth: c.imageWidth)
    }

    // MARK: 识别历史（Supersense Read History 式：回放"刚才读的内容"，端侧零云端）

    @ObservationIgnored let historyStore = RecognitionHistoryStore()

    /// 回放一条历史记录（供历史面板调用）。
    func speakHistory(_ text: String) { speak(text) }

    /// 复制识别内容到剪贴板 + 播报确认——盲人复制后须听到"已复制"，否则不知成败（历史面板与结果按钮共用）。
    func copyRecognition(_ text: String) {
        UIPasteboard.general.string = text
        SpeechHub.shared.speak(FramingStrings.copied(lang), channel: .query, voiceCode: lang.voiceCode)
    }

    // MARK: Siri 频道直达

    @ObservationIgnored private var queuedChannel: AppRoute.FramingChannel?

    /// 排队一个待执行的频道动作（进屏时由 View 从 AppRoute 取走传入；首帧就绪后执行）。
    func queueChannel(_ channel: AppRoute.FramingChannel?) {
        queuedChannel = channel
    }

    private func runChannel(_ channel: AppRoute.FramingChannel) {
        switch channel {
        case .banknote: readCurrency()
        case .scan: readBarcode()
        case .fullPage: if !docMode { toggleDocumentMode() }
        case .bus: readBus()
        case .people: describePeople()
        case .light: readLight()
        case .text: readText() // 语音指令"读文字"直达
        }
    }
    @ObservationIgnored private var paused = false // 关闭/被来电盖上后：停止播报并丢弃在途帧/异步识别结果
    @ObservationIgnored private var docMode = false        // 文档模式（整页取景引导+自动拍摄）
    @ObservationIgnored private var docStableFrames = 0    // 整页完整入画的连续帧数（≥2 自动拍摄）
    @ObservationIgnored private var docCapturing = false   // OCR 进行中，防重复拍摄
    @ObservationIgnored private var docPages: [String] = [] // 多页连读：已读页全文（Envision 批量扫描式）
    @ObservationIgnored private var docAwaitingNextPage = false // 刚读完一页：等旧页移出画面再拍，防同页重复拍

    var arSession: ARSession { source.session }

    func start() {
        lang = FeatureSettings().language          // 进屏解析一次（设置页改语言后重进生效）
        labels = LabelCatalog(language: lang)
        guard DeviceSupport.hasLiDAR else {
            state = .unsupported(FramingStrings.unsupportedDevice(lang))
            guidanceText = FramingStrings.unsupportedShort(lang)
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
        SpeechHub.shared.stopChannel(.query) // 关闭/被来电盖上时立刻闭嘴，避免识别播报串入通话
    }

    private func handle(_ frame: SensorFrame) {
        guard !paused else { return } // 暂停后丢弃在途帧
        guard !exploring else { return } // 触摸探索画布占屏时，暂停实时取景播报（否则与冻结画布抢话，见 P1 审计）
        latestBuffer = frame.pixelBuffer // 供"朗读文字"用最新帧
        latestDepth = frame.depth        // 供"周围的人"报距离
        latestCamera = frame.camera      // 供方位计算用真实视场角

        // Siri 频道直达（Seeing AI 全频道快捷指令惯例）：首帧就绪后自动触发排队的动作。
        if let channel = queuedChannel {
            queuedChannel = nil
            runChannel(channel)
        }
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
        let hint = framing.hint(guidance, language: lang)
        guidanceText = hint

        if guidance == .centered, let target {
            centeredFrames += 1
            let name = labels.localizedName(target.object.label)
            // 防复读：同一目标持续居中只报一次（centeredSpokenLabel），换目标或移出中央后才重报。
            if centeredFrames >= 2, name != centeredSpokenLabel {
                // 置信度透明（核心 ConfidencePolicy，已测）：低置信不说死，带"可能"。
                if ConfidencePolicy().isConfident(target.object.confidence) {
                    resultText = FramingStrings.recognizedResult(name, lang)
                    speak(FramingStrings.thisIs(name, lang))
                } else {
                    resultText = FramingStrings.recognizedMaybeResult(name, lang)
                    speak(FramingStrings.maybeThis(name, lang))
                }
                hintThrottle.noteSpoke(at: frame.timestamp) // "这是X"后提示静默 1.2s+，且须重新稳定才开口（见审查 #4）
                centeredSpokenLabel = name
                centeredFrames = 0
            }
        } else {
            centeredFrames = 0
            centeredSpokenLabel = nil
            // 提示走稳定节流（连续两帧一致才播），且为可丢弃级——总线忙（结果/导航/避障在播）时直接丢弃。
            if hintThrottle.shouldSpeak(hint, at: frame.timestamp) {
                speak(hint, hint: true)
            }
        }
    }

    // MARK: 找周围的物品（Lookout Find 式：通用类别寻找，复用 YOLO + 时钟方位 + LiDAR 距离）

    /// 可寻找的通用类别（COCO 标签；显示名经 LabelCatalog 按语言解析）。只放当前模型真能检出的类别，避免"永远找不到"。
    static let findableCategories: [String] = [
        "chair", "couch", "bed", "dining table", "toilet", "bottle", "cup", "cell phone", "backpack",
    ]
    @ObservationIgnored private var categoryTarget: (label: String, name: String)?

    /// 类别的本地化显示名（中文"椅子"/英文 "chair"，复用核心 LabelCatalog 映射）。
    func categoryName(_ label: String) -> String { labels.localizedName(label) }

    /// 开始寻找一类通用物品（不需要先教，YOLO 直接认）。
    func startCategoryFind(label: String) {
        let name = categoryName(label)
        docMode = false
        findTarget = nil
        categoryTarget = (label, name)
        findPhase = .finding
        lastFindHit = 0
        lastFindHeartbeat = 0
        resultText = ""      // 清掉上次识别遗留的结果文本（与进文档模式一致）
        copyableResult = nil
        guidanceText = FramingStrings.findingGuidance(name, lang)
        speak(FramingStrings.findStartCategory(name, lang))
    }

    /// 类别寻找帧：YOLO 命中类别即报方位与 LiDAR 距离（与"找我的东西"同节奏去抖）。
    private func categoryFindStep(_ frame: SensorFrame, category: (label: String, name: String)) {
        let dets = detector.detect(in: frame.pixelBuffer, regionOfInterest: CGRect(x: 0, y: 0, width: 1, height: 1))
        let hit = dets.filter { $0.label.lowercased() == category.label }
            .max { $0.confidence < $1.confidence }
        if let hit, let box = hit.box {
            guard frame.timestamp - lastFindHit >= 2.5 else { return } // 命中去抖
            lastFindHit = frame.timestamp
            let clock = ClockDirection(normalizedX: box.midX, horizontalFOVDegrees: currentFOV)
            var distText = ""
            if let depth = frame.depth {
                let s = DepthSampling.samples(depth: depth.depth, confidence: depth.confidence,
                                              normalizedX: box.midX, normalizedY: box.midY)
                if let m = DepthSampler().nearestDistance(depths: s.depths, confidences: s.confidences) {
                    distText = FramingStrings.approx(m, lang)
                }
            }
            let where_ = FramingStrings.direction(hour: clock.hour, lang)
            // 找空座位：椅子/沙发命中时用同帧 person 框做占用判定（核心 SeatOccupancy，已测）。
            // 补齐 Apple Magnifier Pro 机型独占的 Announce Seat Occupancy；保守措辞"可能有人"。
            var seatNote = ""
            if category.label == "chair" || category.label == "couch" {
                let persons = dets.filter { $0.label.lowercased() == "person" }.compactMap(\.box)
                seatNote = SeatOccupancy.judge(seat: box, persons: persons) == .free
                    ? FramingStrings.seatLooksFree(lang) : FramingStrings.seatMaybeOccupied(lang)
            }
            guidanceText = FramingStrings.foundCategoryGuide(category.name, where_, lang) + seatNote
            speak(FramingStrings.foundCategorySpeak(category.name, where_, distText, lang) + seatNote)
        } else if frame.timestamp - lastFindHeartbeat >= 6 {
            lastFindHeartbeat = frame.timestamp
            speak(FramingStrings.stillSearchingFor(category.name, lang), hint: true) // 心跳提示：不打断结果播报
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
        resultText = ""      // 清掉上次识别遗留的结果文本（与进文档模式一致）
        copyableResult = nil
        guidanceText = FramingStrings.teachGuidance(lang)
        speak(FramingStrings.teachIntro(lang))
    }

    /// 拍满三张后由命名弹窗回调保存。
    func saveTaughtItem(named name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !pendingPrints.isEmpty else { findPhase = .idle; return }
        itemsStore.save(name: trimmed, prints: pendingPrints)
        pendingPrints = []
        findPhase = .idle
        refreshTaughtItems()
        guidanceText = FramingStrings.learnedResult(trimmed, lang)
        speak(FramingStrings.learnedSpeak(trimmed, lang))
    }

    func deleteTaughtItem(_ name: String) {
        itemsStore.delete(name: name)
        refreshTaughtItems()
    }

    /// 开始寻找某个已学物品。
    func startFinding(_ name: String) {
        let prints = itemsStore.prints(for: name)
        guard !prints.isEmpty else { speak(FramingStrings.noRecord(name, lang)); return }
        docMode = false
        categoryTarget = nil
        findTarget = (name, prints)
        findPhase = .finding
        lastFindHit = 0
        lastFindHeartbeat = 0
        resultText = ""      // 清掉上次识别遗留的结果文本（与进文档模式一致）
        copyableResult = nil
        guidanceText = FramingStrings.findingGuidance(name, lang)
        speak(FramingStrings.findStartTaught(name, lang))
    }

    func stopFindFlow() {
        findPhase = .idle
        findTarget = nil
        categoryTarget = nil
        pendingPrints = []
        resultText = ""        // 清掉上次结果，避免停下后屏幕仍留旧结果
        copyableResult = nil
        guidanceText = FramingStrings.stopped(lang)
    }

    /// 教学帧：约 1s 自动拍一张中央区特征，三张后请命名。
    private func teachStep(_ frame: SensorFrame) {
        guard frame.timestamp - lastTeachShot >= 1.0 else { return }
        lastTeachShot = frame.timestamp
        // 中央 50% 区域：物品举在镜头前的主体区。
        guard let print = Self.featurePrint(in: frame.pixelBuffer,
                                            roi: CGRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5)) else { return }
        pendingPrints.append(print)
        speak(FramingStrings.teachShot(pendingPrints.count, lang))
        guidanceText = FramingStrings.teachProgress(pendingPrints.count, lang)
        if pendingPrints.count >= 3 {
            findPhase = .idle
            showTeachNaming = true
            speak(FramingStrings.teachNamePrompt(lang))
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
            let clock = ClockDirection(normalizedX: best.roi.midX, horizontalFOVDegrees: currentFOV)
            // 距离：用候选区中心的 LiDAR 深度（有就报，没有只报方向）。
            var distText = ""
            if let depth = frame.depth {
                let s = DepthSampling.samples(depth: depth.depth, confidence: depth.confidence,
                                              normalizedX: best.roi.midX, normalizedY: best.roi.midY)
                if let m = DepthSampler().nearestDistance(depths: s.depths, confidences: s.confidences) {
                    distText = FramingStrings.approx(m, lang)
                }
            }
            let where_ = FramingStrings.direction(hour: clock.hour, lang)
            guidanceText = FramingStrings.maybeFoundGuide(target.name, where_, lang)
            speak(FramingStrings.maybeFoundSpeak(target.name, where_, distText, lang))
        } else if frame.timestamp - lastFindHeartbeat >= 6 {
            lastFindHeartbeat = frame.timestamp
            speak(FramingStrings.stillSearching(lang), hint: true) // 心跳提示：不打断结果播报
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
        speak(FramingStrings.analyzing(lang))
        guard let oriented = Self.orientedBuffer(from: live) else { speak(FramingStrings.analyzeFailed(lang)); return }
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
                // 一无所获就别开空白画布，直接提示重对准（见审计 P3）。
                guard !objectItems.isEmpty || !textItems.isEmpty else {
                    self.speak(FramingStrings.nothingToExplore(self.lang))
                    return
                }
                self.exploreItems = objectItems + textItems
                self.exploreImage = UIImage(cgImage: oriented.cgImage)
                self.exploring = true
                self.speak(FramingStrings.exploreIntro(objects: objectItems.count, texts: textItems.count, self.lang))
            }
        }
        request.recognitionLevel = .fast
        request.recognitionLanguages = ocrLanguages
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
        docAwaitingNextPage = false
        if docMode {
            docPages = []
            resultText = ""
            copyableResult = nil
            guidanceText = FramingStrings.docGuidance(lang)
            speak(FramingStrings.docIntro(lang))
        } else if docPages.isEmpty {
            guidanceText = FramingStrings.docExited(lang)
            speak(FramingStrings.docExited(lang))
        } else {
            // 多页连读收尾：全文合并可复制（Envision 批量扫描式）。
            copyableResult = docPages.joined(separator: "\n\n")
            resultText = FramingStrings.docMultiDoneResult(docPages.count, lang)
            guidanceText = FramingStrings.docMultiDoneResult(docPages.count, lang)
            speak(FramingStrings.docMultiDoneSpeak(docPages.count, lang))
            docPages = []
        }
    }

    /// 文档取景引导：页面分割检测 → 边缘出画/太小提示 → 稳定自动拍摄。
    private func documentGuidance(_ frame: SensorFrame) {
        guard !docCapturing else { return }
        let request = VNDetectDocumentSegmentationRequest()
        try? VNImageRequestHandler(cvPixelBuffer: frame.pixelBuffer, options: [:]).perform([request])
        guard let doc = request.results?.first, doc.confidence > 0.5 else {
            docStableFrames = 0
            if docAwaitingNextPage {
                docAwaitingNextPage = false   // 旧页已移出画面：静默等待下一页对准
                guidanceText = FramingStrings.docGuidance(lang)
            } else {
                docHint(FramingStrings.docNoPage(lang), at: frame.timestamp)
            }
            return
        }
        if docAwaitingNextPage {
            // 还是刚读过的那页：提示翻页，不重复拍。
            docStableFrames = 0
            docHint(FramingStrings.docTurnPage(lang), at: frame.timestamp)
            return
        }
        let box = doc.boundingBox // 归一化坐标
        let m: CGFloat = 0.02
        let touchesEdge = box.minX < m || box.maxX > 1 - m || box.minY < m || box.maxY > 1 - m
        let area = box.width * box.height
        // 方向词在相机旋转下易说反，统一用"拿远/靠近"这类无方向提示（稳妥且对盲人更可执行）。
        if touchesEdge {
            docStableFrames = 0
            docHint(FramingStrings.docEdge(lang), at: frame.timestamp)
            return
        }
        if area < 0.18 {
            docStableFrames = 0
            docHint(FramingStrings.docCloser(lang), at: frame.timestamp)
            return
        }
        docStableFrames += 1
        guidanceText = FramingStrings.docHold(lang)
        if docStableFrames >= 2 {
            docCapturing = true
            speak(FramingStrings.docCaptured(lang))
            guidanceText = FramingStrings.docReading(lang)
            captureDocument(frame.pixelBuffer)
        }
    }

    /// 文档引导提示：稳定节流（连续两帧一致才播）+ 可丢弃级，不打断整页朗读等结果播报。
    private func docHint(_ text: String, at now: TimeInterval) {
        guidanceText = text
        if hintThrottle.shouldSpeak(text, at: now) {
            speak(text, hint: true)
        }
    }

    /// 拍摄整页：深拷贝当前帧 → 精确 OCR → 按版面顺序（自上而下、同行从左到右）朗读全文。
    private func captureDocument(_ live: CVPixelBuffer) {
        guard let buffer = copyPixelBuffer(live) else {
            docCapturing = false
            speak(FramingStrings.captureFailed(lang))
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
                self.docStableFrames = 0
                if lines.isEmpty {
                    // 留在读整页模式重新对准即可，不退出（多页流程中途失败不丢已读页）。
                    self.resultText = FramingStrings.noTextFound(self.lang)
                    self.guidanceText = FramingStrings.docRetryGuide(self.lang)
                    self.speak(FramingStrings.docRetryStay(self.lang))
                } else {
                    // 多页连读（Envision 批量扫描式）：本页念完提示翻页；全文随页累计、随时可复制。
                    let full = lines.joined(separator: "\n")
                    self.docPages.append(full)
                    self.historyStore.add(kind: "page", content: full)
                    self.docAwaitingNextPage = true
                    self.copyableResult = self.docPages.joined(separator: "\n\n")
                    self.resultText = FramingStrings.docPageResult(self.docPages.count, lines.first ?? "", self.lang)
                    self.guidanceText = FramingStrings.docDoneGuide(lines.count, self.lang)
                    self.speak(FramingStrings.docPageDonePrefix(self.docPages.count, self.lang)
                               + lines.joined(separator: FramingStrings.docJoinSeparator(self.lang))
                               + FramingStrings.docNextPageHint(self.lang))
                }
            }
        }
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ocrLanguages
        request.usesLanguageCorrection = true
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([request])
        }
    }

    /// 朗读相机里看到的文字（端侧 Vision OCR，中英文）——盲人读标牌/标签/菜单。
    func readText() {
        guard let live = latestBuffer else { speak(FramingStrings.aimText(lang)); return }
        if tooDarkToProceed() { return }
        guard let buffer = copyPixelBuffer(live) else { speak(FramingStrings.recognizeFailed(lang)); return } // 深拷贝供异步安全读
        resultText = FramingStrings.readingText(lang)
        let request = VNRecognizeTextRequest { [weak self] req, _ in
            let texts = (req.results as? [VNRecognizedTextObservation])?
                .compactMap { $0.topCandidates(1).first?.string } ?? []
            let joined = texts.joined(separator: " ")
            DispatchQueue.main.async {
                guard let self else { return }
                let out = joined.isEmpty ? FramingStrings.noTextFound(self.lang) : joined
                self.resultText = out
                self.copyableResult = joined.isEmpty ? nil : joined
                if !joined.isEmpty { self.historyStore.add(kind: "text", content: joined) }
                self.speak(out)
            }
        }
        request.recognitionLanguages = ocrLanguages
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([request])
        }
    }

    /// "前方有什么"：对最新一帧**重新检测**后按左/中/右汇总播报（核心 SceneSummarizer，已测）。
    /// 用 latestBuffer 现检测而非 latestDetections——后者在文档/找东西模式下不更新，会播报陈旧画面（见 P2 审计）。
    func describeScene() {
        if tooDarkToProceed() { return }
        let dets = latestBuffer.map { detector.detect(in: $0, regionOfInterest: CGRect(x: 0, y: 0, width: 1, height: 1)) } ?? latestDetections
        let objects = dets.map { (label: labels.localizedName($0.label), normalizedX: $0.normalizedX) }
        let text = SceneSummarizer().summary(objects: objects, language: lang)
        resultText = text
        copyableResult = nil
        speak(text)
    }

    /// 识别二维码/条码并朗读内容（端侧 Vision）——读 QR 海报、产品码、WiFi 码等。
    func readBarcode() {
        guard let live = latestBuffer else { speak(FramingStrings.aimBarcode(lang)); return }
        if tooDarkToProceed() { return }
        guard let buffer = copyPixelBuffer(live) else { speak(FramingStrings.recognizeFailed(lang)); return } // 深拷贝供异步安全读
        resultText = FramingStrings.scanning(lang)
        let request = VNDetectBarcodesRequest { [weak self] req, _ in
            let payloads = (req.results as? [VNBarcodeObservation])?.compactMap { $0.payloadStringValue } ?? []
            DispatchQueue.main.async {
                guard let self else { return }
                guard let first = payloads.first else {
                    self.resultText = ""
                    self.copyableResult = nil
                    self.speak(FramingStrings.noBarcode(self.lang))
                    return
                }
                self.copyableResult = first
                self.historyStore.add(kind: "barcode", content: first)
                // 先说"这是什么类型"再读内容（核心 BarcodePayload，已测）；商品条码走本地商品库。
                switch BarcodePayload.classify(first) {
                case .productCode:
                    if let name = self.productStore.name(for: first) {
                        self.resultText = FramingStrings.productResult(name, self.lang)
                        self.speak(FramingStrings.thisIs(name, self.lang))
                    } else {
                        self.resultText = FramingStrings.productCodeResult(first, self.lang)
                        self.pendingProductCode = first
                        self.showProductNaming = true
                        self.speak(FramingStrings.productUnknownSpeak(self.lang))
                    }
                case .wifi(let ssid):
                    self.resultText = FramingStrings.wifiResult(ssid, self.lang)
                    self.speak(FramingStrings.wifiSpeak(ssid, self.lang))
                case .url(let host):
                    self.resultText = FramingStrings.urlResult(first, self.lang)
                    self.speak(FramingStrings.urlSpeak(host, self.lang))
                case .phone(let number):
                    self.resultText = FramingStrings.phoneResult(number, self.lang)
                    self.speak(FramingStrings.phoneSpeak(number, self.lang))
                case .contact:
                    self.resultText = FramingStrings.contactResult(self.lang)
                    self.speak(FramingStrings.contactSpeak(self.lang))
                case .text:
                    self.resultText = FramingStrings.codeContent(first, self.lang)
                    self.speak(FramingStrings.recognizedResult(first, self.lang))
                }
            }
        }
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([request])
        }
    }

    /// 周围的人（Seeing AI People 频道式，端侧纯几何）：只数人数、报方位与 LiDAR 距离。
    /// 隐私边界：不识别身份、不估年龄表情、不存任何人脸数据——检测完即弃。
    /// 坐标约定与 YOLO 一致（原始相机缓冲，midX 即方位；深度采样 y 由左下翻到左上）。
    func describePeople() {
        guard let live = latestBuffer else { speak(FramingStrings.aimAhead(lang)); return }
        if tooDarkToProceed() { return }
        guard let buffer = copyPixelBuffer(live) else { speak(FramingStrings.recognizeFailed(lang)); return } // 深拷贝供异步安全读
        // 深度同样深拷贝：人脸检测是异步的，回调时 ARKit 原深度图可能已被回收复用。
        var depthCopy: (depth: CVPixelBuffer, confidence: CVPixelBuffer?)?
        if let d = latestDepth, let dd = copyPixelBuffer(d.depth) {
            depthCopy = (dd, d.confidence.flatMap { copyPixelBuffer($0) })
        }
        resultText = FramingStrings.findingPeople(lang)
        let fov = currentFOV
        let request = VNDetectFaceRectanglesRequest { [weak self] req, _ in
            let boxes = (req.results as? [VNFaceObservation])?.map(\.boundingBox) ?? []
            DispatchQueue.main.async {
                guard let self, !self.paused else { return }
                let people: [(normalizedX: Double, distanceMeters: Double?)] = boxes.map { box in
                    var dist: Double?
                    if let depthCopy {
                        let s = DepthSampling.samples(depth: depthCopy.depth, confidence: depthCopy.confidence,
                                                      normalizedX: Double(box.midX),
                                                      normalizedY: 1 - Double(box.midY)) // Vision 左下 → 深度图左上
                        if let m = DepthSampler().nearestDistance(depths: s.depths, confidences: s.confidences) {
                            dist = m
                        }
                    }
                    return (Double(box.midX), dist)
                }
                let text = PeopleSummarizer().summary(people: people, horizontalFOVDegrees: fov, language: self.lang)
                self.resultText = text
                self.copyableResult = nil
                self.speak(text)
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
        resultText = FramingStrings.rememberedResult(trimmed, lang)
        speak(FramingStrings.rememberedSpeak(trimmed, lang))
    }

    /// 识别人民币纸币面额（端侧 OCR 角号/大写 + 票面主色，核心 CurrencyClassifier，已测）。
    /// 低置信只说"可能"，并提醒换角度确认——识币错了是真金白银，宁可多让用户拍一次。
    func readCurrency() {
        guard let live = latestBuffer else { speak(FramingStrings.aimBanknote(lang)); return }
        if tooDarkToProceed() { return }
        guard let buffer = copyPixelBuffer(live) else { speak(FramingStrings.recognizeFailed(lang)); return } // 深拷贝供异步安全读
        resultText = FramingStrings.readingBanknote(lang)
        let rgb = ColorSampler.averageRGB(in: buffer, rect: CGRect(x: 0.3, y: 0.3, width: 0.4, height: 0.4))
        let request = VNRecognizeTextRequest { [weak self] req, _ in
            let texts = (req.results as? [VNRecognizedTextObservation])?
                .compactMap { $0.topCandidates(1).first?.string } ?? []
            let result = CurrencyClassifier().classify(texts: texts, rgb: rgb)
            DispatchQueue.main.async {
                guard let self else { return }
                self.copyableResult = nil
                if let result {
                    let name = FramingStrings.yuan(result.denomination, self.lang)
                    // 屏显与语音一致地表达不确定性——别屏上"确定"、只语音含糊（见 P2 审计）。
                    self.resultText = result.confident ? FramingStrings.banknoteResult(name, self.lang)
                                                       : FramingStrings.banknoteUncertainResult(name, self.lang)
                    if result.confident { self.historyStore.add(kind: "banknote", content: name) }
                    self.speak(result.confident ? name : FramingStrings.banknoteUncertain(name, self.lang))
                } else {
                    self.resultText = ""
                    self.speak(FramingStrings.banknoteNone(self.lang))
                }
            }
        }
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ocrLanguages
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([request])
        }
    }

    /// 识别画面中央区域的颜色（端侧采样 + 核心 ColorNamer，已测）。
    func readColor() {
        guard let buffer = latestBuffer else { speak(FramingStrings.aimObject(lang)); return }
        if tooDarkToProceed() { return }
        let rect = CGRect(x: 0.4, y: 0.4, width: 0.2, height: 0.2)
        if let rgb = ColorSampler.averageRGB(in: buffer, rect: rect) {
            let name = ColorNamer().name(r: rgb.r, g: rgb.g, b: rgb.b, language: lang)
            resultText = FramingStrings.colorResult(name, lang)
            copyableResult = nil
            speak(FramingStrings.colorSpeak(name, lang))
        } else {
            speak(FramingStrings.colorFailed(lang))
        }
    }

    /// 光线探测（Seeing AI Light 频道式）：报明暗等级 + 亮源方向（左右半区亮度对比，核心 LightMeter，已测）。
    /// 盲人找窗户/灯/亮着的出口通道、确认屋里灯有没有开。
    func readLight() {
        guard let buffer = latestBuffer else { speak(FramingStrings.aimAhead(lang)); return }
        guard let whole = ColorSampler.averageRGB(in: buffer, rect: CGRect(x: 0, y: 0, width: 1, height: 1)),
              let left = ColorSampler.averageRGB(in: buffer, rect: CGRect(x: 0, y: 0, width: 0.33, height: 1)),
              let right = ColorSampler.averageRGB(in: buffer, rect: CGRect(x: 0.67, y: 0, width: 0.33, height: 1))
        else { speak(FramingStrings.lightFailed(lang)); return }
        let side = LightMeter.brighterSide(left: LightMeter.luminance(r: left.r, g: left.g, b: left.b),
                                           right: LightMeter.luminance(r: right.r, g: right.g, b: right.b))
        let text = LightMeter().description(brightness: LightMeter.luminance(r: whole.r, g: whole.g, b: whole.b),
                                            brighterSide: side, language: lang)
        resultText = FramingStrings.lightResult(text, lang)
        copyableResult = nil
        speak(text)
    }

    /// 公交识别（OKO 式，端侧 YOLO+OCR）：认出公交/电车，读车头牌的线路号与终点站。
    /// 多辆车同时进站时帮盲人确认"来的是不是我要坐的那班"。行挑选在核心 BusDisplayReader（已测）。
    func readBus() {
        guard let live = latestBuffer else { speak(FramingStrings.aimAhead(lang)); return }
        if tooDarkToProceed() { return }
        let dets = detector.detect(in: live, regionOfInterest: CGRect(x: 0, y: 0, width: 1, height: 1))
        guard let bus = dets.filter({ ["bus", "train"].contains($0.label.lowercased()) })
            .max(by: { $0.confidence < $1.confidence }), let box = bus.box else {
            speak(FramingStrings.noBusFound(lang))
            return
        }
        guard let buffer = copyPixelBuffer(live) else { speak(FramingStrings.recognizeFailed(lang)); return }
        resultText = FramingStrings.readingBus(lang)
        let clock = ClockDirection(normalizedX: box.midX, horizontalFOVDegrees: currentFOV)
        let where_ = FramingStrings.direction(hour: clock.hour, lang)
        let busName = labels.localizedName(bus.label)
        // OCR 限定在车体框内（NormalizedBox 原点左上 → Vision ROI 原点左下）。
        let roi = CGRect(x: box.x, y: 1 - box.y - box.height, width: box.width, height: box.height)
        let request = VNRecognizeTextRequest { [weak self] req, _ in
            let texts = (req.results as? [VNRecognizedTextObservation])?
                .compactMap { $0.topCandidates(1).first?.string } ?? []
            let picked = BusDisplayReader.pick(texts: texts)
            DispatchQueue.main.async {
                guard let self else { return }
                self.copyableResult = nil
                if picked.isEmpty {
                    self.resultText = FramingStrings.busNoText(busName, where_, self.lang)
                } else {
                    let info = picked.joined(separator: FramingStrings.busInfoSeparator(self.lang))
                    self.resultText = FramingStrings.busResult(busName, where_, info, self.lang)
                }
                self.speak(self.resultText)
            }
        }
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ocrLanguages
        request.regionOfInterest = roi
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([request])
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
        if let b = currentBrightness(), let warning = LightMeter().warning(brightness: b, language: lang),
           LightMeter().level(brightness: b) == .dark {
            speak(warning)
            return true
        }
        return false
    }

    /// OCR 识别语言优先级跟随 App 语言（英文用户优先英文模型，识别更准）。
    private var ocrLanguages: [String] {
        lang == .en ? ["en-US", "zh-Hans"] : ["zh-Hans", "en-US"]
    }

    /// 经全局语音总线 .query 通道：hint=true 为取景/搜索提示（可丢弃，永不打断结果/导航/避障播报），
    /// 其余为结果播报（同通道替换语义，与旧行为一致）。
    private func speak(_ text: String, hint: Bool = false) {
        guard !paused else { return } // 已暂停(关闭/来电)：异步识别回调到达也不再播报
        SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode, droppable: hint)
    }
}

struct FramingAssistView: View {
    @State private var model = FramingAssistViewModel()
    @State private var torchOn = false
    @State private var showFindMenu = false
    @State private var teachName = ""
    @State private var productName = ""
    @State private var showHistory = false
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
                stateOverlay // 相机未运行（被拒/不支持/出错/启动中）：居中说明 + 朗读原因，不再是无声黑屏（见 P1 审计）
            }
            if case .running = model.state {
            VStack {
                HStack {
                    Button {
                        // 只有真开成功才翻状态——否则图标/标签会谎报"已开"而灯是灭的（见审计 P1）。
                        if Torch.set(!torchOn) {
                            torchOn.toggle()
                        } else {
                            SpeechHub.shared.speak(FramingStrings.torchFailed(model.lang), channel: .query, voiceCode: model.lang.voiceCode)
                        }
                    } label: {
                        Image(systemName: torchOn ? "flashlight.on.fill" : "flashlight.off.fill")
                            .font(.title2)
                            .padding()
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .accessibilityLabel(FramingStrings.uiTorch(on: torchOn, model.lang))
                    .padding(.leading)
                    Button { showHistory = true } label: {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.title2)
                            .padding()
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .accessibilityLabel(FramingStrings.uiHistory(model.lang))
                    .accessibilityHint(FramingStrings.uiHistoryHint(model.lang))
                    Spacer()
                    Button(FramingStrings.uiDone(model.lang)) { onClose() }
                        .padding()
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding()
                }
                Spacer()
                // 主操作：与主页磁贴同语言（蜂蜜大按钮），相机画面上始终清晰。
                BeeBigButton(FramingStrings.uiTitle(.whatsAhead, model.lang), systemImage: "eye.fill",
                             subtitle: FramingStrings.uiWhatsAheadSubtitle(model.lang), tint: .beeHoney) {
                    model.describeScene()
                }
                .padding(.horizontal)
                .accessibilityHint(FramingStrings.uiHint(.whatsAhead, model.lang))

                HStack(spacing: BeeSpacing.sm) {
                    overlayAction(FramingStrings.uiTitle(.readText, model.lang), systemImage: "text.viewfinder",
                                  hint: FramingStrings.uiHint(.readText, model.lang)) { model.readText() }
                    overlayAction(FramingStrings.uiTitle(.fullPage, model.lang), systemImage: "doc.text.viewfinder",
                                  hint: FramingStrings.uiHint(.fullPage, model.lang)) { model.toggleDocumentMode() }
                    overlayAction(FramingStrings.uiTitle(.light, model.lang), systemImage: "sun.max.fill",
                                  hint: FramingStrings.uiHint(.light, model.lang)) { model.readLight() }
                }
                .padding(.horizontal)
                HStack(spacing: BeeSpacing.sm) {
                    overlayAction(FramingStrings.uiTitle(.color, model.lang), systemImage: "paintpalette.fill",
                                  hint: FramingStrings.uiHint(.color, model.lang)) { model.readColor() }
                    overlayAction(FramingStrings.uiTitle(.scan, model.lang), systemImage: "qrcode.viewfinder",
                                  hint: FramingStrings.uiHint(.scan, model.lang)) { model.readBarcode() }
                    overlayAction(FramingStrings.uiTitle(.explore, model.lang), systemImage: "hand.draw.fill",
                                  hint: FramingStrings.uiHint(.explore, model.lang)) { model.captureExplore() }
                }
                .padding(.horizontal)
                HStack(spacing: BeeSpacing.sm) {
                    overlayAction(FramingStrings.uiTitle(.banknote, model.lang), systemImage: "banknote.fill",
                                  hint: FramingStrings.uiHint(.banknote, model.lang)) { model.readCurrency() }
                    overlayAction(FramingStrings.uiTitle(.people, model.lang), systemImage: "person.2.fill",
                                  hint: FramingStrings.uiHint(.people, model.lang)) { model.describePeople() }
                    overlayAction(FramingStrings.uiTitle(model.findPhase == .idle ? .find : .stopFind, model.lang),
                                  systemImage: model.findPhase == .idle ? "magnifyingglass" : "stop.circle.fill",
                                  hint: FramingStrings.uiHint(.find, model.lang)) {
                        if model.findPhase == .idle { showFindMenu = true } else { model.stopFindFlow() }
                    }
                }
                .padding(.horizontal)
                HStack(spacing: BeeSpacing.sm) {
                    overlayAction(FramingStrings.uiTitle(.bus, model.lang), systemImage: "bus.fill",
                                  hint: FramingStrings.uiHint(.bus, model.lang)) { model.readBus() }
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
                        Button(FramingStrings.uiCopy(model.lang)) {
                            model.copyRecognition(copyable) // 复制 + 播报确认（与历史面板共用同一路径）
                        }
                            .buttonStyle(.bordered).tint(.white)
                            .frame(minHeight: 44)
                            .accessibilityHint(FramingStrings.uiCopyHint(model.lang))
                    }
                }
                .padding()
                .frame(maxWidth: .infinity)
                // 实底深色结果条：相机画面上白字/蜂蜜字恒高对比（材质会透出画面）。
                .background(Color.beeInk.opacity(reduceTransparency ? 1 : 0.88))
            }
            } // if case .running（仅相机运行时显示操作面板）
        }
        .task {
            ScreenWake.acquire("framing")   // 取景识别相机界面期间屏不灭
            model.start()
            model.refreshTaughtItems()
            // Siri 频道直达：取走待执行频道（无快捷指令进入时为 nil，无副作用）。
            model.queueChannel(AppRoute.shared.pendingChannel)
            AppRoute.shared.pendingChannel = nil
        }
        .onDisappear { model.stop(); Torch.set(false); ScreenWake.release("framing") }
        // VoiceOver 魔法轻点（双指双击）= 主操作"前方有什么"（Seeing AI 同款惯例）。
        .accessibilityAction(.magicTap) { model.describeScene() }
        // 找东西：先列已教的个人物品，再列通用类别（Lookout Find 式），最后教新物品。
        .confirmationDialog(FramingStrings.uiFindMenuTitle(model.lang),
                            isPresented: $showFindMenu, titleVisibility: .visible) {
            ForEach(model.taughtItems, id: \.self) { item in
                Button(FramingStrings.uiFindItem(item, model.lang)) { model.startFinding(item) }
            }
            ForEach(FramingAssistViewModel.findableCategories, id: \.self) { label in
                Button(FramingStrings.uiFindNearby(model.categoryName(label), model.lang)) {
                    model.startCategoryFind(label: label)
                }
            }
            Button(FramingStrings.uiTeachNew(model.lang)) { model.startTeaching() }
            Button(FramingStrings.uiCancel(model.lang), role: .cancel) {}
        } message: {
            Text(FramingStrings.uiFindMenuMessage(model.lang))
        }
        // 扫到陌生商品条码：起名字存本地商品库（键盘话筒可语音输入）。
        .alert(FramingStrings.uiProductNameTitle(model.lang),
               isPresented: Binding(get: { model.showProductNaming },
                                    set: { model.showProductNaming = $0 })) {
            TextField(FramingStrings.uiProductNamePlaceholder(model.lang), text: $productName)
            Button(FramingStrings.uiSave(model.lang)) { model.saveProductName(productName); productName = "" }
            Button(FramingStrings.uiCancel(model.lang), role: .cancel) { productName = "" }
        } message: {
            Text(FramingStrings.uiProductNameMessage(model.lang))
        }
        // 教学拍满三张：命名（键盘话筒可语音输入）。
        .alert(FramingStrings.uiTeachNameTitle(model.lang),
               isPresented: Binding(get: { model.showTeachNaming },
                                    set: { model.showTeachNaming = $0 })) {
            TextField(FramingStrings.uiTeachNamePlaceholder(model.lang), text: $teachName)
            Button(FramingStrings.uiSave(model.lang)) { model.saveTaughtItem(named: teachName); teachName = "" }
            Button(FramingStrings.uiCancel(model.lang), role: .cancel) { teachName = ""; model.stopFindFlow() }
        } message: {
            Text(FramingStrings.uiTeachNameMessage(model.lang))
        }
        // 触摸探索：定格画面全屏呈现，手指划到哪读哪（Seeing AI 式）。
        .fullScreenCover(isPresented: Binding(get: { model.exploring },
                                              set: { if !$0 { model.exitExplore() } })) {
            ExploreCanvas(model: model) { model.exitExplore() }
        }
        // 识别历史（Supersense Read History 式）：回放/复制/删除读过的内容。
        .sheet(isPresented: $showHistory) {
            RecognitionHistorySheet(model: model) { showHistory = false }
        }
    }

    /// 相机不可用时的居中说明（被拒/不支持/出错/启动中）：朗读原因并给出口，避免无声黑屏。
    private var stateOverlay: some View {
        let (text, showSettings): (String, Bool) = {
            switch model.state {
            case .denied: return (FramingStrings.cameraDenied(model.lang), true)
            case .unsupported(let m): return (m, false)
            case .failed(let m): return (FramingStrings.cameraError(m, model.lang), false)
            default: return (FramingStrings.starting(model.lang), false)
            }
        }()
        return VStack(spacing: BeeSpacing.lg) {
            HStack {
                Spacer()
                Button(FramingStrings.uiDone(model.lang)) { onClose() }
                    .padding().background(.ultraThinMaterial, in: Capsule()).padding()
            }
            Spacer()
            Image(systemName: "camera.fill").font(.system(size: 48)).foregroundStyle(.white.opacity(0.7))
                .accessibilityHidden(true)
            Text(text).font(.title3).foregroundStyle(.white)
                .multilineTextAlignment(.center).padding(.horizontal, BeeSpacing.lg)
            if showSettings {
                Button(FramingStrings.openSettings(model.lang)) {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
                .buttonStyle(.borderedProminent).controlSize(.large).tint(.beeHoney)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .id(text) // 状态文案变化即重建，刷新下面的朗读
        .onAppear { SpeechHub.shared.speak(text, channel: .query, voiceCode: model.lang.voiceCode) }
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

/// 识别历史面板（Supersense Read History 式）：最近优先列表，点按回放、可复制/单删/清空。
/// 内容只存本机；删除权完全在用户（可能含信件/票据等敏感文字）。
private struct RecognitionHistorySheet: View {
    let model: FramingAssistViewModel
    let onClose: () -> Void
    @State private var records: [RecognitionRecord] = []
    @State private var query = ""
    // 本面板是否触发过历史回放：仅当触发过、关闭时才停 .query——否则会误停父视图（相机仍在后台识别）
    // 正在播的识别结果，以及复制的"已复制"这类短确认（复审 MED/LOW）。
    @State private var didReplay = false

    /// 按搜索词过滤（核心 RecognitionHistoryStore.filter，已测）。
    private var filtered: [RecognitionRecord] { RecognitionHistoryStore.filter(records, query: query) }

    var body: some View {
        NavigationStack {
            Group {
                if records.isEmpty {
                    Text(FramingStrings.historyEmpty(model.lang))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding()
                } else if filtered.isEmpty {
                    // 有记录但搜不到匹配（区别于"无历史"）——盲人搜不到时须有明确反馈。
                    Text(FramingStrings.historyNoMatch(model.lang))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding()
                } else {
                    List {
                        ForEach(filtered) { r in
                            Button {
                                didReplay = true // 标记触发过回放：关闭时才需停这条（可能很长的）回放
                                model.speakHistory(r.content)
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(FramingStrings.historyKind(r.kind, model.lang))
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(Color.beeHoney)
                                        Spacer()
                                        Text(r.date, style: .time).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Text(r.content).lineLimit(3)
                                }
                            }
                            .accessibilityHint(FramingStrings.uiHistoryRowHint(model.lang))
                            .swipeActions {
                                // 滑动按钮须有 accessibilityLabel：否则 VoiceOver 念 SF Symbol 名（"trash"/"doc on doc"）
                                // 而非"删除"/"复制"——盲人是主用户，此路径无障碍名不可缺。
                                Button(role: .destructive) {
                                    model.historyStore.delete(id: r.id)
                                    records = model.historyStore.records
                                } label: { Image(systemName: "trash") }
                                    .accessibilityLabel(FramingStrings.uiDelete(model.lang))
                                Button { model.copyRecognition(r.content) } label: { // 复制 + 播报确认（盲人须听到成败）
                                    Image(systemName: "doc.on.doc")
                                }
                                    .accessibilityLabel(FramingStrings.uiCopy(model.lang))
                            }
                        }
                    }
                }
            }
            .navigationTitle(FramingStrings.uiHistory(model.lang))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .destructiveAction) {
                    Button(FramingStrings.uiClearAll(model.lang)) {
                        model.historyStore.clear()
                        records = []
                    }
                    .disabled(records.isEmpty)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(FramingStrings.uiDone(model.lang)) { onClose() }
                }
            }
            // 搜索：50 条记录里找"单号/地址"等关键词直达，免逐条 VoiceOver 翻（Seeing AI/Supersense 式）。
            // 仅在有记录时启用搜索栏。
            .searchable(text: $query, prompt: FramingStrings.historySearchPrompt(model.lang))
            .onAppear { records = model.historyStore.records }
            // 关闭历史面板时，仅当**本面板触发过回放**才停 .query——盲人回放长整页后关面板，语音不再
            // 继续念（面板都没了还在读）。但不无条件停：否则会掐断父视图（相机后台仍在识别）正在播的
            // 识别结果、以及复制的"已复制"短确认（复审 MED/LOW）。复制不置 didReplay，其确认不受影响。
            .onDisappear { if didReplay { SpeechHub.shared.stopChannel(.query) } }
        }
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
                        .accessibilityLabel(FramingStrings.uiExploreCanvasLabel(model.lang))
                        .accessibilityAddTraits(.allowsDirectInteraction)
                }
            }
            BeeBigButton(FramingStrings.uiDone(model.lang), systemImage: "checkmark.circle.fill",
                         tint: .beeHoney) { onClose() }
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
