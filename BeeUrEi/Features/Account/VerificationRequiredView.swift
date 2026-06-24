import SwiftUI

/// 共享的紧急警报覆盖层（摔倒/撞击/手动 SOS）：盖在一切之上，提供「我没事」取消与「立即通知」。
/// 由首页(HubView)与未实名门禁屏(VerificationRequiredView)共用——确保门禁屏也有可访问的取消 UI。
struct EmergencyAlertOverlay: View {
    let center: EmergencyAlertCenter
    let lang: Language
    var onFailedHelp: (() -> Void)? = nil

    var body: some View {
        ZStack {
            Color.black.opacity(0.86).ignoresSafeArea()
            VStack(spacing: BeeSpacing.lg) {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 56)).foregroundStyle(Color.beeWarn)
                Text(HomeStrings.fallAlertTitle(lang)).font(.title.bold()).foregroundStyle(.white)
                switch center.phase {
                case .countdown(_, let seconds):
                    Text("\(seconds)").font(.system(size: 64, weight: .heavy)).foregroundStyle(Color.beeHoney).accessibilityHidden(true)
                    BeeBigButton(HomeStrings.imOK(lang), systemImage: "checkmark.circle.fill", tint: .beeSuccess, foreground: .white) { center.cancel() }
                    BeeBigButton(HomeStrings.notifyNow(lang), systemImage: "bell.badge.fill", tint: .beeDanger, foreground: .white) { center.sendNow() }
                case .sending:
                    ProgressView().tint(.white).scaleEffect(1.6)
                case .sent(let n):
                    Text(HomeStrings.fallAlertSent(n, lang)).font(.title3).foregroundStyle(.white).multilineTextAlignment(.center).padding(.horizontal)
                case .failed:
                    Text(HomeStrings.fallAlertFailed(lang)).font(.title3).foregroundStyle(.white).multilineTextAlignment(.center).padding(.horizontal)
                    if let onFailedHelp {
                        BeeBigButton(HomeStrings.helpTitle(lang), systemImage: "hand.raised.fill", tint: .beeHoney) { onFailedHelp() }
                    }
                case .idle:
                    EmptyView()
                }
            }
            .padding()
        }
        .accessibilityAction(.magicTap) { center.cancel() }
    }
}

/// 实名认证门禁屏：当管理员开启「要求实名认证」且当前用户(盲人/协助/亲友)尚未通过 KYC 时，
/// 取代正常主界面——只允许「提交/查询实名认证」与「紧急求助」，以及退出登录。
/// 盲人侧：保持摔倒检测运行 + 全程 SpeechHub 朗读 + 大号紧急按钮（安全攸关功能不被门禁挡住）。
struct VerificationRequiredView: View {
    let session: AuthSession
    private var lang: Language { FeatureSettings().language }
    private var isBlind: Bool { session.user?.role == "blind" }
    private let api = APIClient()

    @State private var status: VerificationStatusInfo?
    @State private var motionMonitor = MotionMonitor()
    @State private var emergency = EmergencyAlertCenter.shared
    @State private var checking = false
    @State private var showLogoutConfirm = false

    var body: some View {
        ZStack {
            NavigationStack {
                ScrollView {
                    VStack(spacing: BeeSpacing.lg) {
                        Image(systemName: "checkmark.shield.fill")
                            .font(.system(size: 56)).foregroundStyle(Color.beeHoney)
                            .padding(.top, BeeSpacing.lg)
                        Text(GateStrings.title(lang)).font(.title.bold()).multilineTextAlignment(.center)
                        Text(GateStrings.explain(lang))
                            .font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center)
                            .padding(.horizontal)

                        statusBlock

                        NavigationLink {
                            KYCFlowView(token: KeychainStore.read() ?? "", spoken: isBlind, onChanged: { Task { await reloadAll() } })
                        } label: {
                            Label(primaryLabel, systemImage: "person.text.rectangle.fill")
                                .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
                        }
                        .buttonStyle(.borderedProminent).controlSize(.large).tint(.beeHoney)

                        // 紧急求助——安全兜底，永不被门禁挡住。
                        Button(role: .destructive) { EmergencyAlertCenter.shared.manualSOS() } label: {
                            Label(GateStrings.sos(lang), systemImage: "sos.circle.fill")
                                .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
                        }
                        .buttonStyle(.bordered).controlSize(.large).tint(.beeDanger)
                        .accessibilityHint(GateStrings.sosHint(lang))

                        Button { Task { await reloadAll(spoken: true) } } label: {
                            Label(GateStrings.checkAgain(lang), systemImage: "arrow.clockwise")
                        }
                        .disabled(checking)

                        Button(GateStrings.logout(lang), role: .destructive) { showLogoutConfirm = true }
                            .font(.subheadline).padding(.top, BeeSpacing.sm)
                    }
                    .padding()
                    .frame(maxWidth: .infinity)
                }
                .navigationTitle(GateStrings.navTitle(lang))
                .navigationBarTitleDisplayMode(.inline)
            }
            if emergency.phase != .idle {
                EmergencyAlertOverlay(center: emergency, lang: lang) // 门禁屏也盖紧急覆盖层（可取消）
            }
        }
        .task {
            // 盲人侧：先（同步）启动摔倒检测，再做网络刷新——绝不让安全兜底等在网络请求后面
            // （慢网/离线时曾延迟数十秒，正是用户被长期停在门禁屏的场景，见复审 SAFETY-MED）。
            if isBlind, FeatureSettings().fallDetectionEnabled {
                motionMonitor.start { event in EmergencyAlertCenter.shared.trigger(event) }
            }
            await reloadAll()
            announce()
        }
        .onDisappear { motionMonitor.stop() }
        .confirmationDialog(AccountStrings.logout(lang), isPresented: $showLogoutConfirm, titleVisibility: .visible) {
            Button(AccountStrings.logoutConfirmAction(lang), role: .destructive) { session.logout() }
            Button(AccountStrings.cancel(lang), role: .cancel) {}
        } message: { Text(AccountStrings.logoutConfirmMessage(lang)) }
    }

    @ViewBuilder private var statusBlock: some View {
        let st = status?.status ?? "none"
        switch st {
        case "pending":
            Label(KYCStrings.pendingNote(lang), systemImage: "clock.fill")
                .padding().frame(maxWidth: .infinity).background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
        case "rejected":
            Label(KYCStrings.rejectedNote(status?.rejectReasonCode, lang), systemImage: "exclamationmark.circle.fill")
                .foregroundStyle(Color.beeDanger)
                .padding().frame(maxWidth: .infinity).background(Color.beeDanger.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
        default:
            EmptyView()
        }
    }

    private var primaryLabel: String {
        switch status?.status ?? "none" {
        case "pending": return GateStrings.viewStatus(lang)
        case "rejected": return KYCStrings.resubmit(lang)
        default: return KYCStrings.start(lang)
        }
    }

    private func reloadAll(spoken: Bool = false) async {
        checking = true
        defer { checking = false }
        status = try? await api.verificationStatus(token: KeychainStore.read() ?? "")
        await session.refreshMe()        // 刷新 verified（管理员通过后门禁即自动解除）
        await session.refreshAppConfig() // 刷新 requireVerification
        if spoken { announce() }
    }

    private func announce() {
        guard isBlind else { return }
        let st = status?.status ?? "none"
        let msg: String
        switch st {
        case "pending": msg = KYCStrings.pendingNote(lang)
        case "rejected": msg = KYCStrings.rejectedNote(status?.rejectReasonCode, lang)
        default: msg = GateStrings.explain(lang)
        }
        SpeechHub.shared.speak(GateStrings.title(lang) + "。" + msg, channel: .query, voiceCode: lang.voiceCode)
    }
}

/// 门禁屏文案（双语）。
enum GateStrings {
    static func navTitle(_ l: Language) -> String { l == .zh ? "实名认证" : "Verification" }
    static func title(_ l: Language) -> String { l == .zh ? "需要先完成实名认证" : "Identity verification required" }
    static func explain(_ l: Language) -> String {
        l == .zh ? "为保障安全与可信，使用本应用需先通过实名认证（人工审核，通常 1–2 个工作日）。审核期间你仍可使用紧急求助。"
                 : "For safety and trust, you must pass identity verification before using the app (reviewed by a person, usually 1–2 business days). Emergency SOS stays available while you wait."
    }
    static func viewStatus(_ l: Language) -> String { l == .zh ? "查看认证状态" : "View verification status" }
    static func sos(_ l: Language) -> String { l == .zh ? "紧急求助" : "Emergency SOS" }
    static func sosHint(_ l: Language) -> String { l == .zh ? "通知你的紧急联系人并附带位置" : "Notifies your emergency contacts with your location" }
    static func checkAgain(_ l: Language) -> String { l == .zh ? "我已通过，刷新" : "I've been approved — refresh" }
    static func logout(_ l: Language) -> String { l == .zh ? "退出登录" : "Sign out" }
}
