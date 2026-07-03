import XCTest
@testable import BeeUrEiCore

final class ThermalPolicyTests: XCTestCase {

    private let policy = ThermalPolicy()

    func testNominalFullRate() {
        let p = policy.plan(for: .nominal)
        XCTAssertEqual(p.targetFPS, 15)
        XCTAssertFalse(p.stopCamera)
        XCTAssertNil(p.advisory)
    }

    func testSeriousDegrades() {
        let p = policy.plan(for: .serious)
        XCTAssertTrue(p.downscale)
        XCTAssertTrue(p.useNanoModel)
        XCTAssertFalse(p.stopCamera)
        XCTAssertNotNil(p.advisory)
    }

    func testCriticalStopsCamera() {
        let p = policy.plan(for: .critical)
        XCTAssertEqual(p.targetFPS, 0)
        XCTAssertTrue(p.stopCamera)
        XCTAssertNotNil(p.advisory)
    }

    func testThermalLevelOrdering() {
        XCTAssertTrue(ThermalLevel.nominal < .fair)
        XCTAssertTrue(ThermalLevel.serious < .critical)
    }

    /// 降级 advisory 双语（修复前热/电/路由三处硬编码中文，英文用户过热时听到中文安全警告）。
    /// 中文与历史文案逐字一致（不悄改体验）；英文不混中文。
    func testDegradeAdvisoriesBilingual() {
        func noChinese(_ s: String?) -> Bool {
            !(s ?? "").contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } })
        }
        // Thermal：中文与历史一致；英文无中文。
        XCTAssertEqual(policy.plan(for: .serious).advisory, "设备发热，已降低处理频率") // 默认 .zh 向后兼容
        XCTAssertEqual(policy.plan(for: .critical, language: .zh).advisory, "设备过热，避障暂停，可呼叫志愿者协助")
        XCTAssertTrue(noChinese(policy.plan(for: .serious, language: .en).advisory))
        XCTAssertTrue(noChinese(policy.plan(for: .critical, language: .en).advisory))
        XCTAssertTrue(policy.plan(for: .critical, language: .en).advisory?.contains("volunteer") ?? false)
        // Power：极低电量/省电模式。
        let power = PowerPolicy()
        XCTAssertEqual(power.plan(batteryLevel: 0.05, lowPowerMode: false).advisory, "电量极低，已降到最低处理频率，请尽快充电")
        XCTAssertTrue(noChinese(power.plan(batteryLevel: 0.05, lowPowerMode: false, language: .en).advisory))
        XCTAssertTrue(noChinese(power.plan(batteryLevel: 0.5, lowPowerMode: true, language: .en).advisory))
        // RoutingFallback：无盲道数据降级。
        let routing = RoutingFallback()
        XCTAssertEqual(routing.decide(hasAccessibleData: false).advisory, "本段无盲道数据，已切换为普通步行 + 实时避障")
        XCTAssertTrue(noChinese(routing.decide(hasAccessibleData: false, language: .en).advisory))
        XCTAssertNil(routing.decide(hasAccessibleData: true, language: .en).advisory)
    }
}
