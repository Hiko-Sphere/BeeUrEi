import XCTest
import CoreLocation
@testable import BeeUrEi

/// F1 第四批：导航 VM 胶水层安全门控单测（mock 定位服务/空间音注入，零权限零音频）。
/// 覆盖：记路精度门控（坏精度不入轨——历史审查项）、回程点数不足拒绝、
/// 回程到达门控（精度可信才宣布到达并停止——单帧差精度误报到达是审查 #1）。
private final class MockNavService: NavigationServicing {
    var onLocation: ((CLLocation) -> Void)?
    var onHeading: ((CLHeading) -> Void)?
    var onAuthDenied: (() -> Void)?
    var startCount = 0
    var stopCount = 0
    func requestAuthAndStart() { startCount += 1 }
    func stop() { stopCount += 1 }
    func geocode(_ query: String) async -> CLLocationCoordinate2D? { nil }
    func walkingManeuvers(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) async -> [(coordinate: CLLocationCoordinate2D, instruction: String)] { [] }
}

private final class MockSpatialCue: SpatialCueing {
    func playCue(azimuthDegrees: Float, distanceMeters: Double?) {}
    func setListenerYaw(_ yaw: Float) {}
    func stop() {}
}

@MainActor
final class NavigationViewModelSafetyTests: XCTestCase {
    private var service: MockNavService!

    /// 纬度 1° ≈ 111km：0.0003° ≈ 33m（> 8m 记路去抖、> 25m 回程路点间距）。
    private let stepDegrees = 0.0003
    private let originLat = 39.9000
    private let lon = 116.4000

    override func tearDown() {
        BreadcrumbStore.shared.reset() // 轨迹存进程内单例，跨测试隔离避免相互污染
        super.tearDown()
    }

    private func makeVM() -> NavigationViewModel {
        service = MockNavService()
        let vm = NavigationViewModel(service: service, spatial: MockSpatialCue())
        // 测试收尾：停导航 + 掐断 NavVoice 队列（真实 AVSpeechSynthesizer 排队播报会拖慢测试进程收尾）。
        addTeardownBlock { @MainActor in
            vm.stop()
            NavVoice.shared.stop()
        }
        return vm
    }

    private func loc(latOffset: Double, accuracy: Double) -> CLLocation {
        CLLocation(coordinate: CLLocationCoordinate2D(latitude: originLat + latOffset, longitude: lon),
                   altitude: 0, horizontalAccuracy: accuracy, verticalAccuracy: 10, timestamp: Date())
    }

    /// 记一条 3 点轨迹：出发点 0 → 33m → 66m（好精度）。
    private func recordTrail(_ vm: NavigationViewModel) {
        vm.startTrailRecording()
        for i in 0...2 { service.onLocation?(loc(latOffset: Double(i) * stepDegrees, accuracy: 5)) }
        XCTAssertEqual(vm.trailCount, 3)
    }

    func testTrailRecordingGatesBadAccuracy() {
        let vm = makeVM()
        vm.startTrailRecording()
        service.onLocation?(loc(latOffset: 0, accuracy: 80))   // 精度差：不入轨
        service.onLocation?(loc(latOffset: 0.01, accuracy: -1)) // 无效精度：不入轨
        XCTAssertEqual(vm.trailCount, 0)
        service.onLocation?(loc(latOffset: 0, accuracy: 5))     // 好精度：入轨
        XCTAssertEqual(vm.trailCount, 1)
    }

    func testBacktrackRefusesWithoutEnoughPoints() {
        let vm = makeVM()
        vm.startTrailRecording()
        service.onLocation?(loc(latOffset: 0, accuracy: 5)) // 只记 1 点
        vm.startBacktrack()
        XCTAssertFalse(vm.running) // 点数不足：拒绝进入回程引导
        XCTAssertEqual(vm.status, NavStrings.noTrailYet(FeatureSettings().language))
    }

    func testBacktrackStartsWithTrail() {
        let vm = makeVM()
        recordTrail(vm)
        vm.stopTrailRecording()
        vm.startBacktrack()
        XCTAssertTrue(vm.running)
    }

    /// 回归：导航 sheet 关闭会重建 @State 模型（语音"原路返回"更会开新 sheet）。轨迹经 BreadcrumbStore
    /// 持久后，新模型仍能据此回程——修复"轨迹随 sheet 关闭丢失、语音原路返回永远空轨迹失败"的 bug。
    func testTrailPersistsAcrossModelRecreation() {
        let vm1 = makeVM()
        recordTrail(vm1)          // 记 3 点（存进单例）
        vm1.stop()                // 关闭旧 sheet：stop() 不应清空轨迹
        let vm2 = makeVM()        // 新 sheet → 新模型（模拟语音 .goHome 开的全新导航页）
        XCTAssertEqual(vm2.trailCount, 3) // 新模型 init 即反映持久轨迹（"原路返回(3点)"按钮可见）
        vm2.startBacktrack()
        XCTAssertTrue(vm2.running) // 据持久轨迹成功进入回程，而非"还没有可返回的路线"
    }

    /// 清除已记路线：持久轨迹被丢弃，之后回程被拒（点数不足）；新模型也看到 0 点。
    func testClearTrailDiscardsPersistedTrail() {
        let vm = makeVM()
        recordTrail(vm)
        vm.clearTrail()
        XCTAssertEqual(vm.trailCount, 0)
        let vm2 = makeVM()
        XCTAssertEqual(vm2.trailCount, 0) // 清除后新会话也无轨迹
        vm2.startBacktrack()
        XCTAssertFalse(vm2.running) // 无轨迹：拒绝回程
    }

    func testArrivalRequiresPreciseFix() {
        let vm = makeVM()
        recordTrail(vm) // 出发点 latOffset 0，最远点 0.0006
        vm.startBacktrack()
        XCTAssertTrue(vm.running)

        // 沿原路细步往回走（~9m/步，好精度），自然触发"越过波谷"逐点推进；
        // 越过出发点 ~20m——最后一个路点(=出发点)也要"先靠近再明显回升"才被消费。
        var offset = 2 * stepDegrees
        while offset >= -0.0002 - 1e-12 {
            service.onLocation?(loc(latOffset: offset, accuracy: 5))
            offset -= 0.00008
        }
        XCTAssertTrue(vm.running, "走完路点尚未以可信精度确认到达，不应停机")

        // 差精度逼近出发点（距离 <15m 但 accuracy=60）：绝不宣布到达/停止（审查 #1）。
        service.onLocation?(loc(latOffset: 0, accuracy: 60))
        XCTAssertTrue(vm.running, "差精度的单帧逼近不得触发到达停机")

        // 好精度逼近 → 宣布到达并停止。
        service.onLocation?(loc(latOffset: 0, accuracy: 5))
        XCTAssertFalse(vm.running)
        XCTAssertEqual(vm.status, NavStrings.nearDestination(FeatureSettings().language))
    }
}
