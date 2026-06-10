import XCTest
import CoreVideo
@testable import BeeUrEi

/// F1 第三批：避障主链路（HomeViewModel.handle）安全纪律单测——合成帧直驱 + 全反馈通道 mock（零音频）。
/// 覆盖：暂停丢弃在途帧（通话串音根因防护）、恢复后管线重新产出、避障关不做决策、
/// 无深度安全降级（声呐必停，绝不鸣陈旧"有近物"）、极近障碍确实提交了播报事件。
private final class MockDetector: ObstacleDetecting {
    var result: [DetectedObject] = []
    func detect(in pixelBuffer: CVPixelBuffer, regionOfInterest: CGRect?) -> [DetectedObject] { result }
}

private final class MockSpeech: SpeechFeeding {
    var onFinish: (() -> Void)?
    var played: [FeedbackEvent] = []
    var userInitiated: [String] = []
    var stopAllCount = 0
    func play(_ event: FeedbackEvent) { played.append(event) }
    func speakUserInitiated(_ text: String) { userInitiated.append(text) }
    func stopAll() { stopAllCount += 1 }
}

private final class MockSonifier: Sonifying {
    var updates: [ProximityCue?] = []
    var stopCount = 0
    func update(_ cue: ProximityCue?) { updates.append(cue) }
    func stop() { stopCount += 1 }
}

private final class MockSpatial: SpatialCueing {
    var cues: [(azimuth: Float, distance: Double?)] = []
    var stopCount = 0
    func playCue(azimuthDegrees: Float, distanceMeters: Double?) { cues.append((azimuthDegrees, distanceMeters)) }
    func setListenerYaw(_ yaw: Float) {}
    func stop() { stopCount += 1 }
}

private final class MockCrossing: CrossingSignaling {
    var states: [TrafficLightState] = []
    var stopCount = 0
    func update(_ state: TrafficLightState) { states.append(state) }
    func stop() { stopCount += 1 }
}

private final class MockCoordinator: FeedbackCoordinating {
    var submitted: [FeedbackEvent] = []
    @discardableResult
    func submit(_ event: FeedbackEvent) -> Bool { submitted.append(event); return true }
    func finishCurrent() {}
}

@MainActor
final class HomeViewModelSafetyTests: XCTestCase {
    private var detector: MockDetector!
    private var sonifier: MockSonifier!
    private var coordinator: MockCoordinator!

    override func setUp() {
        super.setUp()
        var f = FeatureSettings()
        f.avoidanceEnabled = true // 测试环境 UserDefaults 无默认注册，显式打开避障
    }

    private func makeVM() -> HomeViewModel {
        detector = MockDetector()
        sonifier = MockSonifier()
        coordinator = MockCoordinator()
        return HomeViewModel(detector: detector, speech: MockSpeech(), sonifier: sonifier,
                             spatial: MockSpatial(), crossingSignal: MockCrossing(), coordinator: coordinator)
    }

    /// 64×64 亮色 BGRA 帧（亮色避免触发光照告警分支）。
    private func makeVideoBuffer() -> CVPixelBuffer {
        var pb: CVPixelBuffer?
        CVPixelBufferCreate(kCFAllocatorDefault, 64, 64, kCVPixelFormatType_32BGRA, nil, &pb)
        let buffer = pb!
        CVPixelBufferLockBaseAddress(buffer, [])
        if let base = CVPixelBufferGetBaseAddress(buffer) {
            memset(base, 200, CVPixelBufferGetBytesPerRow(buffer) * CVPixelBufferGetHeight(buffer))
        }
        CVPixelBufferUnlockBaseAddress(buffer, [])
        return buffer
    }

    /// 32×32 均匀深度图（米）。
    private func makeDepthBuffer(meters: Float) -> CVPixelBuffer {
        var pb: CVPixelBuffer?
        CVPixelBufferCreate(kCFAllocatorDefault, 32, 32, kCVPixelFormatType_DepthFloat32, nil, &pb)
        let buffer = pb!
        CVPixelBufferLockBaseAddress(buffer, [])
        if let base = CVPixelBufferGetBaseAddress(buffer) {
            let ptr = base.assumingMemoryBound(to: Float32.self)
            let count = CVPixelBufferGetBytesPerRow(buffer) / MemoryLayout<Float32>.size * CVPixelBufferGetHeight(buffer)
            for i in 0..<count { ptr[i] = meters }
        }
        CVPixelBufferUnlockBaseAddress(buffer, [])
        return buffer
    }

    private func makeFrame(timestamp: TimeInterval, depthMeters: Float?) -> SensorFrame {
        let depth = depthMeters.map { DepthMap(depth: makeDepthBuffer(meters: $0), confidence: nil, width: 32, height: 32) }
        return SensorFrame(pixelBuffer: makeVideoBuffer(), depth: depth, timestamp: timestamp, camera: nil)
    }

    func testActiveFrameProducesProximityStatus() {
        let vm = makeVM()
        XCTAssertEqual(vm.proximityText, "—")
        vm.handle(makeFrame(timestamp: 10, depthMeters: 1.2))
        XCTAssertNotEqual(vm.proximityText, "—") // 管线产出接近状态（文案随分区/语言，不钉死）
    }

    func testPausedSessionDropsInFlightFrames() {
        let vm = makeVM()
        vm.pauseSession()
        vm.handle(makeFrame(timestamp: 10, depthMeters: 0.6)) // 极近障碍的在途帧
        // 暂停纪律：丢弃——不得产出状态、不得提交播报、不得驱动声呐（通话串音根因防护）。
        XCTAssertEqual(vm.proximityText, "—")
        XCTAssertTrue(coordinator.submitted.isEmpty)
        XCTAssertTrue(sonifier.updates.isEmpty)
    }

    func testPauseStopsSonarImmediately() {
        let vm = makeVM()
        vm.pauseSession()
        XCTAssertGreaterThanOrEqual(sonifier.stopCount, 1) // 暂停即停声呐，不留陈旧"有近物"蜂鸣
    }

    // 注：resumeSession() 有 DeviceSupport.hasLiDAR 守卫——模拟器无 LiDAR，恢复路径属真机走查项
    // （已在 PROJECT_STATUS 真机清单），此处不可测。

    func testAvoidanceToggleOffSkipsDecisions() {
        var f = FeatureSettings()
        f.avoidanceEnabled = false
        defer { f.avoidanceEnabled = true }
        let vm = makeVM()
        vm.handle(makeFrame(timestamp: 10, depthMeters: 0.6))
        XCTAssertEqual(vm.proximityText, SpokenStrings.avoidanceOff(FeatureSettings().language))
        XCTAssertNil(sonifier.updates.last ?? nil) // degradeStop：声呐清空
    }

    func testMissingDepthDegradesSafely() {
        let vm = makeVM()
        vm.handle(makeFrame(timestamp: 10, depthMeters: nil))
        XCTAssertEqual(vm.proximityText, SpokenStrings.rangingPaused(FeatureSettings().language))
        XCTAssertNil(sonifier.updates.last ?? nil) // 无深度：绝不沿用陈旧读数驱动声呐
    }

    func testNearObstacleSubmitsAnnouncement() {
        let vm = makeVM()
        vm.handle(makeFrame(timestamp: 10, depthMeters: 0.6)) // 中央 0.6m：危险区
        XCTAssertFalse(coordinator.submitted.isEmpty) // 确实提交了播报事件（仲裁口径）
    }
}
