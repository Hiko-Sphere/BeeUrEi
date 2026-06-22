import SwiftUI
import LocalAuthentication

/// 「应用锁」设置分区（盲人侧与协助侧共用）：一个开关 + 说明。
/// 开启前先验证本人一次（确认设备可正常验证），失败则不开启并回滚开关；关闭无需再次验证（此刻已在已解锁会话内）。
/// 设备未设密码/生物识别时开关禁用并给出指引——不臆造无法工作的开关。
struct AppLockSection: View {
    @State private var lock = AppLock.shared
    @State private var on = AppLock.shared.enabled
    @State private var busy = false

    private var lang: Language { FeatureSettings().language }
    private let biometry = AppLock.biometryType()
    private let canAuth = AppLock.canAuthenticate()

    var body: some View {
        Section {
            Toggle(SecurityStrings.toggleLabel(biometry, lang), isOn: $on)
                .disabled(!canAuth || busy)
                .onChange(of: on) { _, want in
                    guard want != lock.enabled else { return }   // 回滚赋值不再触发副作用
                    if want {
                        busy = true
                        Task {
                            let ok = await lock.enableWithAuth(reason: SecurityStrings.enableReason(lang))
                            if !ok { on = false }                // 验证失败：回滚开关
                            busy = false
                        }
                    } else {
                        lock.disable()
                    }
                }
                .accessibilityHint(SecurityStrings.sectionFooter(biometry, lang))
        } header: {
            Text(SecurityStrings.sectionHeader(lang))
        } footer: {
            Text(canAuth ? SecurityStrings.sectionFooter(biometry, lang) : SecurityStrings.noPasscodeFooter(lang))
        }
    }
}
