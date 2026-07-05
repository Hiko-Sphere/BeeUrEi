import XCTest
@testable import BeeUrEi

/// FeatureSettings 行为（非字符串）：恢复默认须覆盖全部"播报/无障碍"偏好。
final class FeatureSettingsTests: XCTestCase {
    private func freshDefaults() -> (UserDefaults, String) {
        let suite = "test.beeurei.featuresettings.\(name)"
        UserDefaults().removePersistentDomain(forName: suite)
        return (UserDefaults(suiteName: suite)!, suite)
    }

    func testResetToDefaultsRestoresBothAudioCuePreferences() {
        let (d, suite) = freshDefaults()
        defer { UserDefaults().removePersistentDomain(forName: suite) }
        var f = FeatureSettings(defaults: d)
        // 两个音效播报偏好都改离默认：spatial 默认开→关、sonar 默认关→开。
        f.spatialObstacleCues = false
        f.proximitySonar = true
        XCTAssertFalse(FeatureSettings(defaults: d).spatialObstacleCues) // 确已改
        XCTAssertTrue(FeatureSettings(defaults: d).proximitySonar)

        FeatureSettings.resetToDefaults(d)

        // "恢复默认"须把**两个**音效播报偏好都归位（此前漏了 spatialObstacleCues，与相邻的接近声呐不一致）。
        XCTAssertTrue(FeatureSettings(defaults: d).spatialObstacleCues, "空间音方向提示应恢复默认(开)")
        XCTAssertFalse(FeatureSettings(defaults: d).proximitySonar, "接近声呐应恢复默认(关)")
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
