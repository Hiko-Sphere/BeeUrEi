import SwiftUI
import LocalAuthentication

/// 应用锁的全屏锁屏：进入即自动触发系统验证（Face ID / Touch ID / 设备密码）；失败/取消后留「解锁」按钮重试。
/// 盲人友好：落地朗读锁定状态，超大「解锁」按钮，VoiceOver 标签清晰；纯深底高对比、不依赖材质。
struct LockScreenView: View {
    let lock: AppLock

    private var lang: Language { FeatureSettings().language }
    private let biometry = AppLock.biometryType()
    @State private var didAutoPrompt = false

    private var lockSymbol: String {
        switch biometry {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        case .opticID: return "opticid"
        default: return "lock.fill"
        }
    }

    var body: some View {
        ZStack {
            Color.beeInk.ignoresSafeArea()
            VStack(spacing: BeeSpacing.lg) {
                Spacer()
                Image(systemName: lockSymbol)
                    .font(.system(size: 64, weight: .bold))
                    .foregroundStyle(Color.beeHoney)
                    .accessibilityHidden(true)
                VStack(spacing: BeeSpacing.xs) {
                    Text(SecurityStrings.lockedTitle(lang)).font(.largeTitle.bold()).foregroundStyle(.white)
                    Text(SecurityStrings.lockedSubtitle(biometry, lang))
                        .font(.headline).foregroundStyle(.white.opacity(0.75))
                        .multilineTextAlignment(.center)
                }
                if let err = lock.lastError {
                    Text(err).font(.subheadline.weight(.semibold)).foregroundStyle(Color.beeWarn)
                        .multilineTextAlignment(.center).padding(.horizontal)
                }
                Spacer()
                BeeBigButton(SecurityStrings.unlock(lang), systemImage: "lock.open.fill", tint: .beeHoney) {
                    Task { await lock.authenticate(reason: SecurityStrings.unlockReason(lang)) }
                }
                .padding(.horizontal)
                .disabled(lock.authenticating)
                .opacity(lock.authenticating ? 0.6 : 1)
                Spacer().frame(height: BeeSpacing.xl)
            }
            .padding()
        }
        // 落地一次性朗读锁定状态（盲人未必看见锁屏；与系统验证弹窗不冲突）。
        .task {
            guard !didAutoPrompt else { return }
            didAutoPrompt = true
            SpeechHub.shared.speak(SecurityStrings.lockedTitle(lang) + "。" + SecurityStrings.lockedSubtitle(biometry, lang),
                                   channel: .query, voiceCode: lang.voiceCode)
            await lock.authenticate(reason: SecurityStrings.unlockReason(lang))   // 自动触发系统验证
        }
        // 验证失败/取消时朗读原因——盲人看不到锁屏上的红字，必须听见才知道要点「解锁」重试。
        .onChange(of: lock.lastError) { _, err in
            if let err { SpeechHub.shared.speak(err, channel: .query, voiceCode: lang.voiceCode) }
        }
        .accessibilityElement(children: .contain)
    }
}
