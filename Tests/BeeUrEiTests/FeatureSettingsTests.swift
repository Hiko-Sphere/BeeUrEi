import XCTest
@testable import BeeUrEi

/// FeatureSettings 行为（非字符串）：恢复默认须覆盖全部"播报/无障碍"偏好。
final class FeatureSettingsTests: XCTestCase {
    private func freshDefaults() -> (UserDefaults, String) {
        let suite = "test.beeurei.featuresettings.\(name)"
        UserDefaults().removePersistentDomain(forName: suite)
        return (UserDefaults(suiteName: suite)!, suite)
    }

    func testResetToDefaultsRestoresAllFeedbackChannelPreferences() {
        let (d, suite) = freshDefaults()
        defer { UserDefaults().removePersistentDomain(forName: suite) }
        var f = FeatureSettings(defaults: d)
        // 三个反馈通道偏好都改离默认：spatial 默认开→关、sonar 默认关→开、haptics 默认开→关。
        f.spatialObstacleCues = false
        f.proximitySonar = true
        f.hapticsEnabled = false
        XCTAssertFalse(FeatureSettings(defaults: d).spatialObstacleCues) // 确已改
        XCTAssertTrue(FeatureSettings(defaults: d).proximitySonar)
        XCTAssertFalse(FeatureSettings(defaults: d).hapticsEnabled)

        FeatureSettings.resetToDefaults(d)

        // "恢复默认"须把**全部**反馈通道偏好归位（震动是新加的通道，须与相邻音效偏好一致进 reset，别漏）。
        XCTAssertTrue(FeatureSettings(defaults: d).spatialObstacleCues, "空间音方向提示应恢复默认(开)")
        XCTAssertFalse(FeatureSettings(defaults: d).proximitySonar, "接近声呐应恢复默认(关)")
        XCTAssertTrue(FeatureSettings(defaults: d).hapticsEnabled, "震动反馈应恢复默认(开)")
    }

    func testHapticsEnabledDefaultsTrueAndPersists() {
        let (d, suite) = freshDefaults()
        defer { UserDefaults().removePersistentDomain(forName: suite) }
        XCTAssertTrue(FeatureSettings(defaults: d).hapticsEnabled, "缺省(未设过)应为开——保持震动一直有的历史行为")
        var f = FeatureSettings(defaults: d)
        f.hapticsEnabled = false
        XCTAssertFalse(FeatureSettings(defaults: d).hapticsEnabled, "关掉后须持久化(下次读仍关)")
    }

    func testResetDoesNotTouchFunctionToggles() {
        let (d, suite) = freshDefaults()
        defer { UserDefaults().removePersistentDomain(forName: suite) }
        var f = FeatureSettings(defaults: d)
        // 避障/导航功能开关与摔倒检测是**功能**开关，恢复"播报/无障碍"默认时刻意不动（见 resetToDefaults 注）。
        f.navigationEnabled = true      // 默认关→开
        f.fallDetectionEnabled = false  // 默认开→关
        FeatureSettings.resetToDefaults(d)
        XCTAssertTrue(FeatureSettings(defaults: d).navigationEnabled, "功能开关不应被'恢复播报默认'重置")
        XCTAssertFalse(FeatureSettings(defaults: d).fallDetectionEnabled, "安全功能开关不应被'恢复播报默认'重置")
    }
}
