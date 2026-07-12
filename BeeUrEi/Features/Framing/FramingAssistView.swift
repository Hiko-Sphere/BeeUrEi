import SwiftUI
import ARKit
import UIKit
import AVFoundation
import CoreGraphics
import CoreVideo
import CoreMotion
import Vision

/// 触摸探索条目：物体框或文字行（定向图像空间，Vision 归一化、原点左下）。
struct ExploreItem: Identifiable {
    let id = UUID()
    let label: String
    let box: CGRect
    let isText: Bool
}

/// 识别结果的一键系统动作（拨号盘/浏览器/邮件/信息）：label 供按钮显示，url 供 UIApplication.open 打开预填。
struct FramingAction: Equatable { let label: String; let url: URL }

/// 取景识别：用相机 + YOLO 找最大目标，语音指引把它移到画面中央对准，对准后说出"这是什么"。
/// 解决竞品最弱的"盲人不知镜头对着哪"。决策逻辑在核心 `FramingGuide`（已测）。
@Observable
final class FramingAssistViewModel {
    private(set) var state: FrameSourceState = .idle
    private(set) var guidanceText = FramingStrings.starting(FeatureSettings().language)
    private(set) var resultText = ""
    private(set) var copyableResult: String?   // OCR/扫码的原始内容，可复制
    // 识别到「可执行内容」（唯一电话/QR 里的链接·邮箱·短信·电话）时的一键动作：驱动结果区一个按钮，点它**打开系统
    // 对应应用并预填**（拨号盘/浏览器/邮件/信息），iOS 要求用户再确认——绝不代拨/代发（OCR 或 QR 可能有误/恶意，
    // 由用户复核后再操作）。切到任何其它识别（stopContinuous）即清，不残留过期按钮。
    private(set) var resultAction: FramingAction?
    private(set) var counting = false                         // 点钞模式：逐张扫纸币累加、报运行总额（Cash Reader 式）
    @ObservationIgnored private var cash = CashCounter()      // 点钞累加器（核心，已测）；分为单位、可撤销
    var torchOn = false                                       // 手电筒开关（手动按钮 + 太暗自动点亮共用；视图绑定）
    @ObservationIgnored private var didAutoTorch = false       // 太暗自动点亮至多一次/会话，之后尊重手动开关不较劲

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
    // OCR 拍摄质量双件（核心已测；ocr-capture-pipeline 清单收尾）：握稳判据（旋转角速率迟滞去抖）+
    // 成片曝光门（反光/太暗/低对比——LightMeter 只管环境明暗，这层管"这一帧能不能读"）。
    @ObservationIgnored private var steadiness = CaptureSteadiness()
    @ObservationIgnored private var steadyState: CaptureSteadiness.State?  // nil=尚无运动数据（模拟器/权限缺）→ fail-open 不拦
    @ObservationIgnored private let motion = CMMotionManager()
    @ObservationIgnored private let exposure = CaptureExposure()
    @ObservationIgnored private var throttle = AnnouncementThrottle()  // 自动拍质量门指导语节流（4s，防每帧重复念"拿稳"）
    @ObservationIgnored private var latestDepth: DepthMap?
    @ObservationIgnored private var latestCamera: CameraGeometry?
    @ObservationIgnored private var latestTimestamp: TimeInterval = 0 // 最近帧时间戳（mach 秒），供点按动作与连续 feed 同钟
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

    /// 语音"找<物名>"：按物名派发——已教物品 → startFinding；可找类别 → startCategoryFind；都不匹配 → 提示。
    /// 需在 refreshTaughtItems() 之后调用（taughtItems 已就绪）。核心解析用 FindTargetResolver（已测）。
    func queueFind(_ name: String?) {
        guard let name, !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        let cats = FramingAssistViewModel.findableCategories.map { (label: $0, name: categoryName($0)) }
        switch FindTargetResolver.resolve(spoken: name, taughtNames: taughtItems, categories: cats) {
        case .taught(let t): startFinding(t)
        case .category(let label): startCategoryFind(label: label)
        case .none: speak(FramingStrings.findNotRecognized(name, lang))
        }
    }

    private func runChannel(_ channel: AppRoute.FramingChannel) {
        // 切到光探测以外的任何动作：先停连续光探测音调，避免它与识别结果播报/其它模式抢声。
        if channel != .light { stopContinuous() }
        // 切到配色比对以外的任何动作 → 放弃未完成的配色第一件（避免拿旧色和无关物比对）。
        if channel != .colorMatch { colorMatchFirst = nil }
        switch channel {
        case .banknote: readCurrency()
        case .countCash: if !counting { toggleCounting() } // 语音"数钱"直达点钞模式（已开则不重复切；用户随后逐张扫）
        case .scan: readBarcode()
        case .fullPage: if !docMode { toggleDocumentMode() }
        case .bus: readBus()
        case .people: describePeople()
        case .light: readLight()
        case .color: readColor() // 语音指令"什么颜色"直达（配衣服/比色）
        case .colorMatch: matchColors() // 语音"这两件搭不搭"：扫两次比配色
        case .text: readText() // 语音指令"读文字"直达
        case .dates: readDates() // 语音"保质期/日期"：读包装上的日期
        case .phone: readPhoneNumbers() // 语音"读电话号码"：读名片/海报上的号码
        case .email: readEmails() // 语音"读邮箱"：读名片/信笺上的邮箱地址
        }
    }
    @ObservationIgnored private var paused = false // 关闭/被来电盖上后：停止播报并丢弃在途帧/异步识别结果
    @ObservationIgnored private var scanGeneration = 0 // 每识别一个新条码 +1：在线查商品的慢响应回来后据此丢弃（复审#1，防错报别的商品过敏原）
    // 连续光探测音调（Seeing AI Light/Envision 式）：开启后扫动手机、音高随亮度实时升降定位光源。
    // 复用已真机验证的 ProximitySonifier（避障声呐）——只换 cue 来源（亮度而非距离），音频路径不变。
    @ObservationIgnored private let lightSonifier = ProximitySonifier()
    private(set) var lightToneOn = false
    // 连续颜色模式（Seeing AI Color 频道式）：开启后指哪报哪，颜色变了且稳定才播（复用已测 HintThrottle）。
    // 盲人配衣服/比色高频。与光探测互斥（同为持续背景模式）。
    private(set) var colorContinuousOn = false
    @ObservationIgnored private var colorThrottle = HintThrottle(stableTicks: 3, minGap: 1.0, repeatGap: 8.0)
    // 配色比对的"第一件"颜色（扫两次的中间态）：切到别的动作/关闭识别屏时清空（见 runChannel/onDisappear）。
    @ObservationIgnored private var colorMatchFirst: (r: Double, g: Double, b: Double)?
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
        // 握稳判据数据源：设备旋转角速率（三轴取模）。不可用（模拟器/受限）→ steadyState 恒 nil＝fail-open。
        if motion.isDeviceMotionAvailable {
            motion.deviceMotionUpdateInterval = 1.0 / 30.0
            motion.startDeviceMotionUpdates(to: .main) { [weak self] dm, _ in
                guard let self, let r = dm?.rotationRate else { return }
                let mag = (r.x * r.x + r.y * r.y + r.z * r.z).squareRoot()
                self.steadyState = self.steadiness.ingest(rotationRate: mag, at: ProcessInfo.processInfo.systemUptime)
            }
        }
    }

    func stop() {
        paused = true
        source.stop()
        motion.stopDeviceMotionUpdates()
        steadyState = nil
        steadiness.reset()
        stopContinuous() // 关闭/来电盖上：停所有持续背景模式，避免离开界面后仍在响
        SpeechHub.shared.stopChannel(.query) // 关闭/被来电盖上时立刻闭嘴，避免识别播报串入通话
    }

    private func handle(_ frame: SensorFrame) {
        guard !paused else { return } // 暂停后丢弃在途帧
        guard !exploring else { return } // 触摸探索画布占屏时，暂停实时取景播报（否则与冻结画布抢话，见 P1 审计）
        latestBuffer = frame.pixelBuffer // 供"朗读文字"用最新帧
        latestDepth = frame.depth        // 供"周围的人"报距离
        latestCamera = frame.camera      // 供方位计算用真实视场角
        latestTimestamp = frame.timestamp // 供点按动作与连续 feed 同钟

        // 连续光探测：每帧（不受下方 0.4s 节流约束，扫动要跟手）把整帧亮度映射成音调喂声呐。
        // 仅在无其它持久模式时响（文档/找物/探索占屏时不响，避免抢声）。
        if lightToneOn, !docMode, findPhase == .idle, !exploring, let b = currentBrightness() {
            lightSonifier.update(LightSonification.cue(brightness: b))
        }

        // Siri 频道直达（Seeing AI 全频道快捷指令惯例）：首帧就绪后自动触发排队的动作。
        if let channel = queuedChannel {
            queuedChannel = nil
            runChannel(channel)
        }
        guard frame.timestamp - lastProcess >= 0.4 else { return }
        lastProcess = frame.timestamp

        // 连续颜色：指哪报哪——中央区颜色变了且稳定才播（避免刷屏）。放在 0.4s 处理节流之后，
        // 让 HintThrottle 按处理帧（≈2.5/s）评估稳定性（stableTicks=3≈1.2s，与取景指导同节奏），
        // 且 ColorSampler/ColorNamer 只在处理帧计算而非每视频帧（省电）。光探测因要跟手仍留在节流前。
        if colorContinuousOn, !docMode, findPhase == .idle, let buffer = latestBuffer,
           let rgb = ColorSampler.averageRGB(in: buffer, rect: CGRect(x: 0.4, y: 0.4, width: 0.2, height: 0.2)) {
            let name = ColorNamer().describe(r: rgb.r, g: rgb.g, b: rgb.b, language: lang) // 带深浅（深蓝/浅绿）
            if colorThrottle.shouldSpeak(name, at: frame.timestamp) {
                resultText = FramingStrings.colorResult(name, lang)
                speak(FramingStrings.colorSpeak(name, lang))
            }
        }

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
        stopContinuous() // 切到其它识别活动：停所有持续背景模式（光探测/连续颜色）
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
        stopContinuous() // 切到其它识别活动：停所有持续背景模式（光探测/连续颜色）
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
        stopContinuous() // 切到找物：停所有持续背景模式（光探测/连续颜色），与 startCategoryFind 一致
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
        stopContinuous() // 进触摸探索前停所有持续背景模式：光探测靠自治定时器发声，仅停喂帧不会闭嘴（会抢探索朗读）
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
        stopContinuous() // 切到其它识别活动：停所有持续背景模式（光探测/连续颜色）
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
        // 复审：自动快门是 CaptureSteadiness 的**本命消费者**（"稳了自动拍"），此前只有手动读文字过质量门、
        // 自动拍绕过——手抖/反光时自动拍下糊页，版面朗读念出乱码盲人不自知。门不过：不累计稳定帧并给出
        // 具体指导（拿稳/换角度），fail-open（无运动数据/正常帧照旧）。
        let gate = Self.captureGate(quality: Self.lumaStats(from: frame.pixelBuffer)
                                        .map { exposure.assess(meanLuminance: $0.mean, brightClippedFraction: $0.clipped, contrast: $0.contrast) } ?? .ok,
                                    steadiness: steadyState)
        if gate.blocks {
            docStableFrames = 0
            if let advice = gate.speakAdvice(exposure: exposure, lang: lang),
               throttle.shouldAnnounce(key: "doc:gate", now: frame.timestamp, minGap: 4) {
                speak(advice)
            }
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
            // 版面阅读顺序统一走核心 ReadingOrder（从上到下、行内左→右，正确的排序-分行两步法）——替换原先手写的
            // 成对比较器（`abs(midY差)>阈值 ? 按midY : 按minX` 非严格弱序，边界版式可能排错）。同一视觉行的多块并成一行。
            let items: [(text: String, box: CGRect)] = ((req.results as? [VNRecognizedTextObservation]) ?? []).compactMap { o in
                guard let s = o.topCandidates(1).first?.string else { return nil }
                return (s, o.boundingBox)
            }
            let lines = FramingAssistViewModel.orderedOCRLines(from: items)
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

    /// Vision 文本观测(文本 + 归一化 bbox，Vision 原点左下、y 向上) → 按**阅读顺序**分行：委托已测的核心
    /// ReadingOrder（从上到下、行内从左到右）。翻 y 适配：ReadingOrder 要 y 向下 → `y = 1 - box.maxY`。
    /// 读文字/读整页共用此单一实现——消除重复排序与**非传递比较器**隐患（Vision 不保证返回顺序，直接拼接
    /// 会让盲人听到错乱文本；见 ReadingOrder 注释）。
    static func orderedOCRLines(from items: [(text: String, box: CGRect)]) -> [String] {
        ReadingOrder.lines(items.map {
            ReadingOrder.Block(text: $0.text, x: Double($0.box.minX), y: Double(1 - $0.box.maxY), height: Double($0.box.height))
        })
    }
    static func orderedOCRText(from items: [(text: String, box: CGRect)]) -> String {
        orderedOCRLines(from: items).joined(separator: "\n")
    }

    /// OCR 正文主体是否中文（决定朗读用**中文还是英文语音**，与 App 仅有的 zh/en 语音匹配）——OCR 同时识别中英文
    /// (recognitionLanguages 双语)，但此前一律用 App 语言的语音朗读：中文语音念英文告示/菜单（或英文语音念中文）＝乱码。
    /// 对标 Seeing AI 按文本语言选嗓音。判据=CJK 汉字占「汉字+拉丁字母」之比：中文文本 CJK 密集、英文≈0；阈值 0.12
    /// 稳妥分开——少量 CJK 噪声（如英文里一个乱码汉字）不误判成中文；真中文即便夹英文词也判中文（**边界偏中文侧保守**：
    /// 中文语音读夹杂英文尚可听，英文语音读中文=全乱码，代价不对称）。纯数字/符号(无汉字无字母)→false(按英文，数字两语音皆可)。
    static func dominantTextIsChinese(_ text: String) -> Bool {
        var cjk = 0, latin = 0
        for u in text.unicodeScalars {
            let v = u.value
            if (0x4E00...0x9FFF).contains(v) || (0x3400...0x4DBF).contains(v) || (0xF900...0xFAFF).contains(v) { cjk += 1 }
            else if (0x41...0x5A).contains(v) || (0x61...0x7A).contains(v) { latin += 1 }
        }
        let total = cjk + latin
        guard total > 0 else { return false }
        return Double(cjk) / Double(total) >= 0.12
    }

    /// 朗读相机里看到的文字（端侧 Vision OCR，中英文）——盲人读标牌/标签/菜单。
    func readText() {
        stopContinuous() // 切到其它识别活动：停所有持续背景模式（光探测/连续颜色）
        guard let live = latestBuffer else { speak(FramingStrings.aimText(lang)); return }
        if tooDarkToProceed() { return }
        guard let buffer = copyPixelBuffer(live) else { speak(FramingStrings.recognizeFailed(lang)); return } // 深拷贝供异步安全读
        resultText = FramingStrings.readingText(lang)
        let request = VNRecognizeTextRequest { [weak self] req, _ in
            // Vision 不保证按阅读顺序返回观测 → 经核心 ReadingOrder 重排(从上到下、行内左→右)，否则盲人听到错乱文本。
            let obs = (req.results as? [VNRecognizedTextObservation]) ?? []
            let items: [(text: String, box: CGRect)] = obs.compactMap { o in
                guard let s = o.topCandidates(1).first?.string else { return nil }
                return (s, o.boundingBox)
            }
            // 逐行置信度：低置信度朗读须如实带"可能不准确"（核心 OCRConfidenceGate，已测）——盲人看不到画面，
            // 把糊字误读当真去按（药品剂量/门牌）后果严重。与拍摄质量门互补（那层挡拍前抖动/反光，这层兜识别后）。
            let confs = obs.compactMap { $0.topCandidates(1).first?.confidence }
            let joined = FramingAssistViewModel.orderedOCRText(from: items)
            DispatchQueue.main.async {
                guard let self else { return }
                if joined.isEmpty {
                    self.resultText = FramingStrings.noTextFound(self.lang)
                    self.copyableResult = nil
                    self.speak(FramingStrings.noTextFound(self.lang)) // "没有识别到文字"：App 语言提示
                } else {
                    // 复制留存的是**纯识别文本**（不含提醒，避免把"（可能不准确）"粘进备忘录）；朗读/显示带提醒。
                    // 提醒语言随**文本语言**（非 App 语言）：否则英文正文配中文提醒会让 speakInTextLanguage 选错嗓音。
                    let textLang: Language = FramingAssistViewModel.dominantTextIsChinese(joined) ? .zh : .en
                    let annotated = OCRConfidenceGate().annotate(joined, lineConfidences: confs, language: textLang)
                    self.resultText = annotated
                    self.copyableResult = joined
                    self.historyStore.add(kind: "text", content: joined)
                    self.speakInTextLanguage(annotated) // 正文语音随文本语言（中/英）切换；提醒随之朗读
                }
            }
        }
        request.recognitionLanguages = ocrLanguages
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([request])
        }
    }

    /// 读包装日期（保质期/生产日期等）：OCR → 核心 LabelDateReader 挑出带日期标签的行，原样播报 + "请核对"。
    /// 盲人看不到食品/药品上的日期（高频刚需）。安全：只如实读印出的日期，绝不判是否过期（LabelDateReader）。
    func readDates() {
        stopContinuous()
        guard let live = latestBuffer else { speak(FramingStrings.aimText(lang)); return }
        if tooDarkToProceed() { return }
        guard let buffer = copyPixelBuffer(live) else { speak(FramingStrings.recognizeFailed(lang)); return }
        resultText = FramingStrings.readingDates(lang)
        let request = VNRecognizeTextRequest { [weak self] req, _ in
            let texts = (req.results as? [VNRecognizedTextObservation])?
                .compactMap { $0.topCandidates(1).first?.string } ?? []
            DispatchQueue.main.async {
                guard let self else { return }
                if let out = LabelDateReader.find(texts: texts, language: self.lang) {
                    self.resultText = out
                    self.copyableResult = out
                    self.historyStore.add(kind: "dates", content: out) // 存识别历史，供事后搜索/回看（与 readText 口径一致）
                    self.speak(out)
                } else {
                    self.resultText = FramingStrings.noDatesFound(self.lang)
                    self.copyableResult = nil
                    self.speak(self.resultText)
                }
            }
        }
        request.recognitionLanguages = ocrLanguages
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([request])
        }
    }

    /// 读电话号码（名片/海报）：OCR → 核心 PhoneNumberFinder 抽出号码，逐个读出 + "请核对再拨"。
    /// 盲人读不到印刷号码。安全：只读不自动拨（OCR 可能错位，拨错号代价高，见 PhoneNumberFinder）。
    func readPhoneNumbers() {
        stopContinuous()
        guard let live = latestBuffer else { speak(FramingStrings.aimText(lang)); return }
        if tooDarkToProceed() { return }
        guard let buffer = copyPixelBuffer(live) else { speak(FramingStrings.recognizeFailed(lang)); return }
        resultText = FramingStrings.readingPhone(lang)
        let request = VNRecognizeTextRequest { [weak self] req, _ in
            let texts = (req.results as? [VNRecognizedTextObservation])?
                .compactMap { $0.topCandidates(1).first?.string } ?? []
            let numbers = PhoneNumberFinder.find(texts: texts)
            DispatchQueue.main.async {
                guard let self else { return }
                if numbers.isEmpty {
                    self.resultText = FramingStrings.noPhoneFound(self.lang)
                    self.copyableResult = nil
                } else {
                    self.resultText = FramingStrings.phoneResult(numbers, self.lang)
                    self.copyableResult = numbers.joined(separator: "\n")
                    self.historyStore.add(kind: "phone", content: numbers.joined(separator: "\n")) // 存识别历史，供事后回看/复制拨打
                    // 唯一号码 → 提供"拨打"（打开系统拨号盘预填，不自动拨）。多个号码则不猜该拨哪个，只读+可复制。
                    if numbers.count == 1, let tel = EmergencyPhoneFallback.telURLString(numbers[0]), let url = URL(string: tel) {
                        self.resultAction = FramingAction(label: FramingStrings.uiDial(self.lang), url: url)
                    }
                }
                self.speak(self.resultText)
            }
        }
        request.recognitionLanguages = ocrLanguages
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cvPixelBuffer: buffer, options: [:]).perform([request])
        }
    }

    /// 读邮箱地址（名片/信笺）：OCR → 核心 EmailFinder 抽出邮箱，读出 + 唯一邮箱可一键写邮件（mailto:，不代发）。
    func readEmails() {
        stopContinuous()
        guard let live = latestBuffer else { speak(FramingStrings.aimText(lang)); return }
        if tooDarkToProceed() { return }
        guard let buffer = copyPixelBuffer(live) else { speak(FramingStrings.recognizeFailed(lang)); return }
        resultText = FramingStrings.readingEmail(lang)
        let request = VNRecognizeTextRequest { [weak self] req, _ in
            let texts = (req.results as? [VNRecognizedTextObservation])?
                .compactMap { $0.topCandidates(1).first?.string } ?? []
            let emails = EmailFinder.find(texts: texts)
            DispatchQueue.main.async {
                guard let self else { return }
                if emails.isEmpty {
                    self.resultText = FramingStrings.noEmailFound(self.lang)
                    self.copyableResult = nil
                } else {
                    self.resultText = FramingStrings.emailFoundResult(emails, self.lang)
                    self.copyableResult = emails.joined(separator: "\n")
                    self.historyStore.add(kind: "email", content: emails.joined(separator: "\n"))
                    if emails.count == 1, let url = URL(string: "mailto:\(emails[0])") {
                        self.resultAction = FramingAction(label: FramingStrings.uiSendEmail(self.lang), url: url) // 打开邮件撰写预填
                    }
                }
                self.speak(self.resultText)
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
        stopContinuous() // 切到其它识别活动：停所有持续背景模式（光探测/连续颜色）
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
                self.scanGeneration += 1 // 新条码入账：任何在途在线查询（上一个未知商品）从此作废，避免慢响应错报到本次结果上（复审#1）
                self.historyStore.add(kind: "barcode", content: first)
                // 先说"这是什么类型"再读内容（核心 BarcodePayload，已测）；商品条码走本地商品库。
                switch BarcodePayload.classify(first) {
                case .productCode:
                    if let name = self.productStore.name(for: first) {
                        // 净含量+过敏原(确定含)+微量(可能含)后缀与名字**一次 speak**（.query 通道替换语义，分两次会吞前半句）。
                        let quantitySuffix = FramingStrings.productQuantitySpeak(self.productStore.quantity(for: first), self.lang) ?? ""
                        let allergenSuffix = FramingStrings.productAllergensSpeak(self.productStore.allergens(for: first), self.lang) ?? ""
                        let tracesSuffix = FramingStrings.productTracesSpeak(self.productStore.traces(for: first), self.lang) ?? ""
                        let nutritionSuffix = FramingStrings.productNutritionSpeak(self.productStore.nutriScore(for: first), self.productStore.novaGroup(for: first), self.lang) ?? ""
                        let nutrientLevelsSuffix = FramingStrings.productNutrientLevelsSpeak(self.productStore.nutrientLevels(for: first), self.lang) ?? ""
                        let dietarySuffix = FramingStrings.productDietaryLabelsSpeak(self.productStore.dietaryLabels(for: first), self.lang) ?? ""
                        self.resultText = FramingStrings.productResult(name, self.lang) + quantitySuffix + allergenSuffix + tracesSuffix + nutritionSuffix + nutrientLevelsSuffix + dietarySuffix
                        self.speak(FramingStrings.thisIs(name, self.lang) + quantitySuffix + allergenSuffix + tracesSuffix + nutritionSuffix + nutrientLevelsSuffix + dietarySuffix)
                    } else {
                        // 本地没起过名：先在线查一次（Open Food Facts）——查到直接报名字并记住（对标 Seeing AI），
                        // 查不到/离线再回退到"用户起名"（严格附加，绝不回退失败）。
                        self.resultText = FramingStrings.productCodeResult(first, self.lang)
                        self.lookUpProductOnline(barcode: first)
                    }
                case .wifi:
                    // .wifi 分类只带 SSID；密码才是扫码接网的关键，须完整解析出凭据（含密码，含转义）。
                    let cred = BarcodePayload.parseWifi(first)
                    self.resultText = FramingStrings.wifiResult(cred, self.lang)
                    self.speak(FramingStrings.wifiSpeak(cred, self.lang))
                    if let pw = cred?.password { self.copyableResult = pw } // 密码单独可复制，直接粘贴进 Wi-Fi 设置，免逐字听记
                case .url(let host):
                    self.resultText = FramingStrings.urlResult(first, self.lang)
                    self.speak(FramingStrings.urlSpeak(host, self.lang))
                    // 仅 http(s) 提供"打开链接"（.url 分类本就是 http(s)）；用户先听到域名、点按才打开浏览器（不自动跳）。
                    if let url = URL(string: first), let s = url.scheme?.lowercased(), s == "http" || s == "https" {
                        self.resultAction = FramingAction(label: FramingStrings.uiOpenLink(self.lang), url: url)
                    }
                case .phone(let number):
                    self.resultText = FramingStrings.phoneResult(number, self.lang)
                    self.speak(FramingStrings.phoneSpeak(number, self.lang))
                    if let tel = EmergencyPhoneFallback.telURLString(number), let url = URL(string: tel) {
                        self.resultAction = FramingAction(label: FramingStrings.uiDial(self.lang), url: url) // 打开拨号盘预填
                    }
                case .email(let addr):
                    self.resultText = FramingStrings.emailResult(addr, self.lang)
                    self.speak(FramingStrings.emailSpeak(addr, self.lang))
                    if let a = addr, let url = URL(string: "mailto:\(a)") {
                        self.resultAction = FramingAction(label: FramingStrings.uiSendEmail(self.lang), url: url) // 打开邮件撰写
                    }
                case .sms(let number, let body):
                    self.resultText = FramingStrings.smsResult(number, body, self.lang)
                    self.speak(FramingStrings.smsSpeak(number, body, self.lang))
                    let digits = (number ?? "").filter { $0.isNumber || $0 == "+" }
                    if !digits.isEmpty, let url = URL(string: "sms:\(digits)") {
                        self.resultAction = FramingAction(label: FramingStrings.uiSendSms(self.lang), url: url) // 打开信息
                    }
                case .contact:
                    // 解析名片（vCard/MECARD，核心 VCardParser 已测）：读出姓名/单位/电话/邮箱，唯一电话可一键拨打。
                    if let c = VCardParser.parse(first) {
                        self.resultText = FramingStrings.contactDetail(name: c.name, org: c.org, phones: c.phones, emails: c.emails, self.lang)
                        // 可复制内容改为解析后的可读信息（比原始 vCard 文本更有用）。
                        self.copyableResult = self.resultText
                        self.speak(self.resultText)
                        if c.phones.count == 1, let tel = EmergencyPhoneFallback.telURLString(c.phones[0]), let url = URL(string: tel) {
                            self.resultAction = FramingAction(label: FramingStrings.uiDial(self.lang), url: url)
                        }
                    } else {
                        self.resultText = FramingStrings.contactResult(self.lang)
                        self.speak(FramingStrings.contactSpeak(self.lang)) // 解析不出字段：退化为"这是名片，可复制"
                    }
                case .geo(let lat, let lng, let label):
                    // 位置码：报"这是一个位置"+地名；"导航"动作用 Apple 地图**步行方向**(daddr+dirflg=w)直接开始导航
                    // 到该点——而非 ?ll= 只落图钉让盲人再手动找"路线"（见 geoNavigationURL）。坐标 WGS-84，境内自动纠偏。
                    self.resultText = FramingStrings.geoResult(lat, lng, label, self.lang)
                    self.speak(FramingStrings.geoSpeak(label, self.lang))
                    if let url = URL(string: FramingStrings.geoNavigationURL(lat, lng)) {
                        self.resultAction = FramingAction(label: FramingStrings.uiNavigate(self.lang), url: url)
                    }
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
        stopContinuous() // 切到其它识别活动：停所有持续背景模式（光探测/连续颜色）
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

    /// 开/关点钞模式：开=清零并进入逐张累加（此后每次识别纸币都计入并报运行总额）；关=报最终总额。
    func toggleCounting() {
        if counting {
            counting = false
            let msg = cash.isEmpty ? FramingStrings.cashEmpty(lang)
                                   : FramingStrings.cashTotal(totalFen: cash.totalFen, count: cash.count, lang)
            resultText = msg
            speak(msg)
        } else {
            cash.reset()
            counting = true
            resultText = ""
            speak(FramingStrings.cashCountingStarted(lang))
        }
    }

    /// 撤销上一张（误扫/同一张扫了两次）。
    func undoLastNote() {
        guard !cash.isEmpty else { speak(FramingStrings.cashNothingToUndo(lang)); return }
        cash.undoLast()
        let msg = FramingStrings.cashUndone(totalFen: cash.totalFen, count: cash.count, lang)
        resultText = cash.isEmpty ? "" : FramingStrings.cashTotal(totalFen: cash.totalFen, count: cash.count, lang)
        speak(msg)
    }

    /// 清零重新数。
    func resetCash() {
        cash.reset()
        resultText = ""
        speak(FramingStrings.cashReset(lang))
    }

    /// 识别人民币纸币面额（端侧 OCR 角号/大写 + 票面主色，核心 CurrencyClassifier，已测）。
    /// 低置信只说"可能"，并提醒换角度确认——识币错了是真金白银，宁可多让用户拍一次。
    func readCurrency() {
        stopContinuous() // 切到其它识别活动：停所有持续背景模式（光探测/连续颜色）
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
                    let name = FramingStrings.yuan(result.denomination, jiao: result.jiao, self.lang)
                    // 点钞模式：**只累加确定识别**（不确定的不入账——钱数错是真金白银），报"加 X，共 …元"。
                    if self.counting {
                        if result.confident {
                            self.cash.add(denomination: result.denomination, jiao: result.jiao)
                            self.historyStore.add(kind: "banknote", content: name)
                            let msg = FramingStrings.cashAdded(name, totalFen: self.cash.totalFen, count: self.cash.count, self.lang)
                            self.resultText = msg
                            self.speak(msg)
                        } else {
                            // 不确定不入账，提醒换角度再扫这张（避免把不确定的钱数进总额）。
                            self.resultText = FramingStrings.banknoteUncertainResult(name, self.lang)
                            self.speak(FramingStrings.banknoteUncertain(name, self.lang))
                        }
                        return
                    }
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

    /// 识别颜色（点按）：先报一次中央区域颜色，并开启**连续模式**——之后指哪报哪，颜色变了且稳定
    /// 才播（配衣服/比色）。再点一次「识别颜色」或离开即关。与光探测互斥。
    func readColor() {
        if colorContinuousOn { stopColorContinuous(); return } // 已开 → 再点关闭
        stopLightTone() // 互斥：开颜色前停光探测
        let spoken = readColorOnce()
        colorContinuousOn = true
        colorThrottle = HintThrottle(stableTicks: 3, minGap: 1.0, repeatGap: 8.0) // 重置节流基线
        // 预置刚播的颜色为基线（与 feed 同 mach 钟），否则新节流器 lastSpoke=0 会在下一处理帧
        // 立刻把同色再报一遍（还掐断前句）。之后仅颜色变化或超 repeatGap 才开口。
        if let spoken { colorThrottle.seed(spoken, at: latestTimestamp) }
    }

    /// 识别画面中央区域的颜色一次（端侧采样 + 核心 ColorNamer，已测）。返回实际播报的颜色名（供节流预置）。
    @discardableResult
    private func readColorOnce() -> String? {
        guard let buffer = latestBuffer else { speak(FramingStrings.aimObject(lang)); return nil }
        if tooDarkToProceed() { return nil }
        let rect = CGRect(x: 0.4, y: 0.4, width: 0.2, height: 0.2)
        if let rgb = ColorSampler.averageRGB(in: buffer, rect: rect) {
            let name = ColorNamer().describe(r: rgb.r, g: rgb.g, b: rgb.b, language: lang) // 带深浅（深蓝/浅绿）
            resultText = FramingStrings.colorResult(name, lang)
            copyableResult = nil
            speak(FramingStrings.colorSpeak(name, lang))
            return name
        } else {
            speak(FramingStrings.colorFailed(lang))
            return nil
        }
    }

    /// 配色比对（扫两次判"搭不搭"——盲人配衣决策刚需；和谐度判定在核心 ColorNamer.harmony，已测）。
    /// 第一次扫：记住第一件颜色并提示对准第二件；第二次扫：比对两色并播报和谐度，随后复位。
    func matchColors() {
        if colorContinuousOn { stopColorContinuous() } // 与连续颜色互斥
        stopLightTone()
        guard let buffer = latestBuffer else { speak(FramingStrings.aimObject(lang)); return }
        if tooDarkToProceed() { return }
        let rect = CGRect(x: 0.4, y: 0.4, width: 0.2, height: 0.2)
        guard let rgb = ColorSampler.averageRGB(in: buffer, rect: rect) else {
            speak(FramingStrings.colorFailed(lang)); return
        }
        let namer = ColorNamer()
        copyableResult = nil
        if let first = colorMatchFirst {
            // 第二件 → 比对并播报，随后复位（下一次从头开始）。
            let firstName = namer.describe(r: first.r, g: first.g, b: first.b, language: lang)
            let secondName = namer.describe(r: rgb.r, g: rgb.g, b: rgb.b, language: lang)
            let verdict = SpokenStrings.colorHarmony(
                namer.harmony(r1: first.r, g1: first.g, b1: first.b, r2: rgb.r, g2: rgb.g, b2: rgb.b), lang)
            colorMatchFirst = nil
            resultText = FramingStrings.colorMatchResult(firstName, secondName, verdict, lang)
            speak(resultText)
        } else {
            // 第一件 → 记住并提示对准第二件。
            colorMatchFirst = rgb
            resultText = FramingStrings.colorMatchFirstStored(namer.describe(r: rgb.r, g: rgb.g, b: rgb.b, language: lang), lang)
            speak(resultText)
        }
    }

    /// 光线探测（点按）：先说一次明暗+亮源方向的概述，并开启**连续音调模式**——之后扫动手机、
    /// 音高随亮度实时升降，靠耳朵定位窗户/灯（再点一次「光线探测」或离开即关）。
    /// 盲人找窗户/灯/亮着的出口通道、确认屋里灯有没有开。
    func readLight() {
        if lightToneOn { stopLightTone(); return } // 已开 → 再点关闭
        stopColorContinuous() // 互斥：开光探测前停连续颜色
        readLightOnce()
        lightToneOn = true // 开启连续音调；帧循环据此每帧喂声呐
    }

    /// 关闭连续光探测音调。
    func stopLightTone() {
        guard lightToneOn else { return }
        lightToneOn = false
        lightSonifier.stop()
    }

    /// 关闭连续颜色模式。
    func stopColorContinuous() {
        colorContinuousOn = false
    }

    /// 停掉所有持续背景模式（光探测 + 连续颜色）——切到其它识别活动/离开界面时统一调用。
    func stopContinuous() {
        stopLightTone()
        stopColorContinuous()
        resultAction = nil // 切到其它识别：清掉上次结果遗留的一键动作按钮
    }

    /// 光线探测一次性概述（明暗等级 + 亮源方向，核心 LightMeter，已测）。
    private func readLightOnce() {
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
        stopContinuous() // 切到其它识别活动：停所有持续背景模式（光探测/连续颜色）
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
                // 到站信息（还有约N分钟 / N站 / 即将到站）：站台上盲人最想知道"我的车还有多久到"。
                let arrival = BusDisplayReader.arrivalHint(texts: texts, language: self.lang)
                let sep = FramingStrings.busInfoSeparator(self.lang)
                if picked.isEmpty {
                    // 没读清线路/终点，但读到了到站信息 → 至少把它报出来，比"没读清"有用。
                    if let arrival {
                        self.resultText = FramingStrings.busResult(busName, where_, arrival, self.lang)
                    } else {
                        self.resultText = FramingStrings.busNoText(busName, where_, self.lang)
                    }
                } else {
                    var info = picked.joined(separator: sep)
                    if let arrival { info += sep + arrival }
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

    /// 未知商品条码：先在线查一次商品名（服务端代理 Open Food Facts）。查到 → 报名字并存进本地商品库（下次离线也能报）；
    /// 查不到/离线/未登录/任何错误 → 回退到"用户起名"弹窗（与改动前完全一致，严格附加、绝不回退失败）。
    private func lookUpProductOnline(barcode: String) {
        speak(FramingStrings.productLookingUp(lang), hint: true) // 即时可丢弃提示，避免网络期间盲人以为卡住
        let gen = scanGeneration // 本次查询绑定当前扫码代际
        Task { [weak self] in
            guard let self else { return }
            var found: APIClient.ProductLookupInfo?
            if let token = KeychainStore.read() {
                found = await APIClient().lookupProduct(token: token, barcode: barcode)
            }
            guard !self.paused else { return } // 已关闭/被来电盖上：不再改 UI/播报
            // 期间又扫了新条码（gen 已变）→ 丢弃这次的慢响应：否则会把 A 商品的名字/过敏原报到已切换的 B 结果上（复审#1，安全）
            guard gen == self.scanGeneration else { return }
            if let info = found {
                let allergens = info.allergens ?? []
                let traces = info.traces ?? []
                let dietaryLabels = info.dietaryLabels ?? []
                let nutrientLevels = info.nutrientLevels ?? [:]
                self.productStore.save(barcode: barcode, name: info.name, allergens: allergens, traces: traces,
                                       nutriScore: info.nutriScore, novaGroup: info.novaGroup, dietaryLabels: dietaryLabels, quantity: info.quantity,
                                       nutrientLevels: nutrientLevels) // 过敏原+微量+营养+膳食标注+净含量+逐素含量档随名字存，下次离线也能报
                let quantitySuffix = FramingStrings.productQuantitySpeak(info.quantity, self.lang) ?? ""
                let allergenSuffix = FramingStrings.productAllergensSpeak(allergens, self.lang) ?? ""
                let tracesSuffix = FramingStrings.productTracesSpeak(traces, self.lang) ?? ""
                let nutritionSuffix = FramingStrings.productNutritionSpeak(info.nutriScore, info.novaGroup, self.lang) ?? ""
                let nutrientLevelsSuffix = FramingStrings.productNutrientLevelsSpeak(nutrientLevels, self.lang) ?? ""
                let dietarySuffix = FramingStrings.productDietaryLabelsSpeak(dietaryLabels, self.lang) ?? ""
                self.resultText = FramingStrings.productResult(info.name, self.lang) + quantitySuffix + allergenSuffix + tracesSuffix + nutritionSuffix + nutrientLevelsSuffix + dietarySuffix
                self.speak(FramingStrings.thisIs(info.name, self.lang) + quantitySuffix + allergenSuffix + tracesSuffix + nutritionSuffix + nutrientLevelsSuffix + dietarySuffix) // 一次 speak：.query 替换语义
            } else {
                // 回退：原"起名"路径（弹窗 + 提示），与在线查询前行为一致。
                self.pendingProductCode = barcode
                self.showProductNaming = true
                self.speak(FramingStrings.productUnknownSpeak(self.lang))
            }
        }
    }

    /// 太暗则处理并返回 true（识别/OCR 在暗处会失败）。**关键**：设备有手电筒就自动点亮解决问题——
    /// 盲人正因看不见才用 App，无从自己找灯/开手电；只提醒"太暗"却不点灯等于把人卡在死路。点亮后本帧仍暗、
    /// 提示重新对准，连续模式随后帧被照亮自动继续。每会话至多自动点一次，之后尊重用户手动开关、不反复较劲。
    private func tooDarkToProceed() -> Bool {
        // ① 环境明暗（LightMeter，原行为不变：暗→自动开手电/警告）。
        if let b = currentBrightness(), LightMeter().level(brightness: b) == .dark {
            if !torchOn, !didAutoTorch, Torch.set(true) {
                torchOn = true
                didAutoTorch = true
                speak(FramingStrings.torchAutoOn(lang))
                return true
            }
            speak(LightMeter().warning(brightness: b, language: lang) ?? SpokenStrings.lightLowWarning(lang))
            return true
        }
        // ② 握稳（CaptureSteadiness 核心已测）：正在明显移动时拍下的帧 OCR 必糊、识别失败却不自知。
        //    无运动数据（nil，模拟器/受限）fail-open 不拦；settling（快稳了）放行——只拦明确的 moving。
        // ③ 成片曝光门（CaptureExposure）：反光（大片高光溢出，字全白丢失）→ 拦 + 指导换角度；
        //    低对比（褪色/字底相近）→ **只提醒不拦**（仍可能读出，宁多试不多拦）；太暗已由 ① 兜住。
        let decision = Self.captureGate(quality: latestBuffer.flatMap { Self.lumaStats(from: $0) }
                                            .map { exposure.assess(meanLuminance: $0.mean, brightClippedFraction: $0.clipped, contrast: $0.contrast) } ?? .ok,
                                        steadiness: steadyState)
        if let advice = decision.speakAdvice(exposure: exposure, lang: lang) { speak(advice) }
        return decision.blocks
    }

    /// 拍摄门决策（纯函数，管线与测试共用——中子它=拔掉质量门）：
    /// moving→拦（拿稳指导）；glare→拦（换角度指导）；lowContrast→放行但提醒；其余静默放行。
    /// 优先级：握稳先于曝光（动着拍什么曝光都糊）。
    enum CaptureGateDecision: Equatable {
        case proceed
        case advise(CaptureExposure.Quality)       // 放行 + 播报建议（lowContrast）
        case blockSteady                            // 拦：请拿稳
        case blockExposure(CaptureExposure.Quality) // 拦：曝光问题（glare）
        var blocks: Bool { if case .proceed = self { return false }; if case .advise = self { return false }; return true }
        func speakAdvice(exposure: CaptureExposure, lang: Language) -> String? {
            switch self {
            case .proceed: return nil
            case .advise(let q), .blockExposure(let q): return exposure.advice(q, language: lang)
            case .blockSteady: return FramingStrings.holdSteady(lang)
            }
        }
    }
    nonisolated static func captureGate(quality: CaptureExposure.Quality,
                                        steadiness: CaptureSteadiness.State?) -> CaptureGateDecision {
        if steadiness == .moving { return .blockSteady }
        switch quality {
        case .glare: return .blockExposure(.glare)
        case .lowContrast: return .advise(.lowContrast)
        case .tooDark, .ok: return .proceed // tooDark 已由 LightMeter 路径处理（先于本门），此处放行防双报
        }
    }

    /// 亮度统计适配层（YCbCr 420f 亮度平面直读，1/8 步长降采样）：mean/clipped(≥248)/contrast(=2σ 夹 1)。
    /// 非 420 双平面格式（罕见）返回 nil → 曝光门 fail-open。nonisolated static 供单测合成帧验证。
    nonisolated static func lumaStats(from buffer: CVPixelBuffer) -> (mean: Double, clipped: Double, contrast: Double)? {
        let fmt = CVPixelBufferGetPixelFormatType(buffer)
        guard fmt == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange || fmt == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
              CVPixelBufferGetPlaneCount(buffer) >= 1 else { return nil }
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(buffer, 0) else { return nil }
        let w = CVPixelBufferGetWidthOfPlane(buffer, 0), h = CVPixelBufferGetHeightOfPlane(buffer, 0)
        let stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
        guard w > 0, h > 0 else { return nil }
        let ptr = base.assumingMemoryBound(to: UInt8.self)
        var count = 0, clippedCount = 0
        var sum = 0.0, sumSq = 0.0
        var y = 0
        while y < h {
            var x = 0
            while x < w {
                let v = Double(ptr[y * stride + x]) / 255.0
                sum += v; sumSq += v * v; count += 1
                if v >= 0.97 { clippedCount += 1 }
                x += 8
            }
            y += 8
        }
        guard count > 0 else { return nil }
        let mean = sum / Double(count)
        let variance = max(0, sumSq / Double(count) - mean * mean)
        let contrast = min(1, 2 * variance.squareRoot())
        return (mean, Double(clippedCount) / Double(count), contrast)
    }

    /// OCR 识别语言优先级跟随 App 语言（英文用户优先英文模型，识别更准）。
    // 简体 + **繁体** + 英文（繁中 zh-Hant 此前缺失，台湾/港澳盲人扫繁体乱码）；策略抽到核心可单测。
    private var ocrLanguages: [String] {
        OCRLanguagePolicy.recognitionLanguages(interfaceLanguage: lang)
    }

    /// 经全局语音总线 .query 通道：hint=true 为取景/搜索提示（可丢弃，永不打断结果/导航/避障播报），
    /// 其余为结果播报（同通道替换语义，与旧行为一致）。
    private func speak(_ text: String, hint: Bool = false) {
        guard !paused else { return } // 已暂停(关闭/来电)：异步识别回调到达也不再播报
        SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode, droppable: hint)
    }

    /// 朗读**纯 OCR 正文**，语音随文本主体语言（中/英）自动选择——否则中文语音念英文告示/菜单（或反之）＝乱码
    /// （对标 Seeing AI 多语言朗读）。仅用于无 App 文案框架的纯正文（读文字）；带 App 语言前后缀的混合播报仍用 speak。
    private func speakInTextLanguage(_ text: String) {
        guard !paused else { return }
        let voice = FramingAssistViewModel.dominantTextIsChinese(text) ? Language.zh.voiceCode : Language.en.voiceCode
        SpeechHub.shared.speak(text, channel: .query, voiceCode: voice)
    }
}

struct FramingAssistView: View {
    @State private var model = FramingAssistViewModel()
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
                        if Torch.set(!model.torchOn) {
                            model.torchOn.toggle()
                        } else {
                            SpeechHub.shared.speak(FramingStrings.torchFailed(model.lang), channel: .query, voiceCode: model.lang.voiceCode)
                        }
                    } label: {
                        Image(systemName: model.torchOn ? "flashlight.on.fill" : "flashlight.off.fill")
                            .font(.title2)
                            .padding()
                            .background(.ultraThinMaterial, in: Circle())
                    }
                    .accessibilityLabel(FramingStrings.uiTorch(on: model.torchOn, model.lang))
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
                    overlayAction(FramingStrings.lightToneTitle(model.lightToneOn, model.lang),
                                  systemImage: model.lightToneOn ? "sun.max.circle.fill" : "sun.max.fill",
                                  hint: FramingStrings.uiHint(.light, model.lang)) { model.readLight() }
                }
                .padding(.horizontal)
                HStack(spacing: BeeSpacing.sm) {
                    overlayAction(FramingStrings.colorContinuousTitle(model.colorContinuousOn, model.lang),
                                  systemImage: model.colorContinuousOn ? "paintpalette.fill" : "paintpalette",
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
                    // 点钞（Cash Reader 式）：开启后每次识别纸币都累加并报运行总额。
                    overlayAction(model.counting ? FramingStrings.stopCountingLabel(model.lang) : FramingStrings.startCountingLabel(model.lang),
                                  systemImage: model.counting ? "checkmark.circle.fill" : "dollarsign.circle",
                                  hint: FramingStrings.uiHint(.banknote, model.lang)) { model.toggleCounting() }
                }
                .padding(.horizontal)
                .padding(.bottom, model.counting ? 0 : 8)
                // 点钞进行中：撤销上一张（误扫/重复扫）/ 清零重数。
                if model.counting {
                    HStack(spacing: BeeSpacing.sm) {
                        overlayAction(FramingStrings.undoNoteLabel(model.lang), systemImage: "arrow.uturn.backward",
                                      hint: FramingStrings.undoNoteLabel(model.lang)) { model.undoLastNote() }
                        overlayAction(FramingStrings.resetCashLabel(model.lang), systemImage: "arrow.counterclockwise",
                                      hint: FramingStrings.resetCashLabel(model.lang)) { model.resetCash() }
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 8)
                }

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
                    // 可执行内容（电话/链接/邮箱/短信）：一键打开系统对应应用并预填（不代拨/代发——用户复核后再操作）。
                    if let action = model.resultAction {
                        Button(action.label) { UIApplication.shared.open(action.url) }
                            .buttonStyle(.borderedProminent).tint(.beeHoney)
                            .frame(minHeight: 44)
                            .accessibilityHint(FramingStrings.uiActionHint(model.lang))
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
            // 语音"找我的钥匙"：按物名派发到已教物品/可找类别（refreshTaughtItems 后，taughtItems 已就绪）。
            model.queueFind(AppRoute.shared.pendingFind)
            AppRoute.shared.pendingFind = nil
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
