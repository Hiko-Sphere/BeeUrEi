import SwiftUI

func roleDisplayName(_ role: String, _ l: Language) -> String {
    switch role {
    case "blind": return l == .zh ? "求助者（视障）" : "Blind / low vision"
    case "helper": return l == .zh ? "协助者" : "Helper"
    case "family": return l == .zh ? "亲友" : "Family"
    case "admin": return l == .zh ? "管理员" : "Admin"
    case "developer": return l == .zh ? "开发者" : "Developer"
    default: return role
    }
}

/// 记住"上次确认进入时的角色"，让**之前登录过**的用户再次打开 App 时直接进主界面，
/// 不必每次都经过"进入"确认页（登出/切换角色时清空）。
struct RoleEntryStore {
    private let key = "entry.lastRole"
    var lastRole: String? {
        get { UserDefaults.standard.string(forKey: key) }
        nonmutating set {
            if let newValue { UserDefaults.standard.set(newValue, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
    }
}


/// 协助端角色（协助者 / 亲友）：合并后共用同一套界面，同时具备
/// 「帮助陌生人（志愿者队列+匹配）」与「帮助我绑定的亲人」全部功能。
func isAssistRole(_ role: String) -> Bool { role == "helper" || role == "family" }

/// 各角色界面通用「账号」区：查看账号、切换角色、退出登录。
struct RoleAccountSection: View {
    let session: AuthSession
    let onSwitchRole: () -> Void
    @State private var showLogoutConfirm = false
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        Section(HelperStrings.accountHeader(lang)) {
            if let u = session.user {
                LabeledContent(lang == .zh ? "用户" : "User", value: u.displayName)
                LabeledContent(lang == .zh ? "角色" : "Role", value: roleDisplayName(u.role, lang))
            }
            Button(HelperStrings.switchRole(lang)) { onSwitchRole() }
            Button(HelperStrings.logout(lang), role: .destructive) { showLogoutConfirm = true }
        }
        // 退出登录是破坏性操作（误触即掉线）——先确认（与各账号入口一致，见审计 P1）。
        .confirmationDialog(AccountStrings.logout(lang), isPresented: $showLogoutConfirm, titleVisibility: .visible) {
            Button(AccountStrings.logoutConfirmAction(lang), role: .destructive) { session.logout() }
            Button(AccountStrings.cancel(lang), role: .cancel) {}
        } message: {
            Text(AccountStrings.logoutConfirmMessage(lang))
        }
    }
}

/// 登录后**确认角色**再进入。开发者可选任一角色界面（测试）。
struct RoleEntryView: View {
    let account: AccountInfo
    let session: AuthSession
    let onEnter: (String) -> Void
    @State private var showLogoutConfirm = false
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        VStack(spacing: BeeSpacing.md) {
            Spacer()
            AvatarView(dataURL: account.avatar, name: account.displayName, size: 88) // 登录用户头像
                .overlay(Circle().strokeBorder(Color.beeHoney.opacity(0.5), lineWidth: 2))
            Text(lang == .zh ? "你好，\(account.displayName)" : "Hello, \(account.displayName)").font(.title.bold())
            // 角色徽章。
            Text(roleDisplayName(account.role, lang))
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14).padding(.vertical, 6)
                .background(Color.beeHoney.opacity(0.18), in: Capsule())
                .foregroundStyle(Color.beeAccent)
                .accessibilityLabel((lang == .zh ? "账号角色：" : "Account role: ") + roleDisplayName(account.role, lang))

            Spacer()

            if account.role == "developer" {
                Text(lang == .zh ? "开发者：选择以哪个角色界面进入" : "Developer: choose which role's interface to enter")
                    .font(.subheadline).foregroundStyle(.secondary)
                // helper 即合并后的协助端（含原 family 全部功能），故不再单列 family。
                ForEach(["blind", "helper", "admin", "developer"], id: \.self) { r in
                    Button((lang == .zh ? "以 \(roleDisplayName(r, lang)) 进入" : "Enter as \(roleDisplayName(r, lang))")) { onEnter(r) }
                        .buttonStyle(.bordered).controlSize(.large)
                }
            } else {
                BeeBigButton(lang == .zh ? "进入" : "Enter", systemImage: "arrow.right.circle.fill",
                             subtitle: (lang == .zh ? "以\(roleDisplayName(account.role, lang))身份"
                                                    : "as \(roleDisplayName(account.role, lang))")) { onEnter(account.role) }
            }

            Button(AccountStrings.logout(lang), role: .destructive) { showLogoutConfirm = true }
                .font(.subheadline)
                .padding(.top, BeeSpacing.sm)
        }
        .padding(BeeSpacing.lg)
        .confirmationDialog(AccountStrings.logout(lang), isPresented: $showLogoutConfirm, titleVisibility: .visible) {
            Button(AccountStrings.logoutConfirmAction(lang), role: .destructive) { session.logout() }
            Button(AccountStrings.cancel(lang), role: .cancel) {}
        } message: {
            Text(AccountStrings.logoutConfirmMessage(lang))
        }
    }
}

/// 全站公告 / 维护模式横幅（管理员后台推送，经 /api/app-config 下发）。
/// 维护优先于公告；都没有则不占空间。盲人侧出现时主动朗读（SpeechHub：VO 开走公告、未开走 TTS）。
struct GlobalBanner: View {
    @Environment(AuthSession.self) private var session
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        if session.maintenance.active {
            let msg = session.maintenance.message.isEmpty
                ? (lang == .zh ? "系统维护中，部分功能暂时不可用" : "Under maintenance — some features are temporarily unavailable")
                : session.maintenance.message
            banner(text: msg, bg: Color.beeDanger, icon: "wrench.and.screwdriver.fill")
        } else if session.announcement.active && !session.announcement.message.isEmpty {
            banner(text: session.announcement.message,
                   bg: session.announcement.level == "warning" ? Color.beeWarn : Color.beeAccent,
                   icon: "megaphone.fill")
        }
    }

    @ViewBuilder private func banner(text: String, bg: Color, icon: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.subheadline.bold())
            Text(text).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, BeeSpacing.md).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(bg)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(text)
        .onAppear { SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode) }
    }
}

/// 按角色分发到对应主界面。顶部统一叠加全站横幅（公告/维护）——
/// 用 safeAreaInset：无横幅时零占位，有横幅时把主内容下推，相机全屏页也不会被遮挡。
struct RoleHomeView: View {
    let role: String
    let session: AuthSession
    let onSwitchRole: () -> Void

    var body: some View {
        content.safeAreaInset(edge: .top, spacing: 0) { GlobalBanner() }
    }

    /// 该角色是否受实名门禁约束（与服务端 isGateableRole 同口径）。admin/developer 不门控。
    private var gateable: Bool { role == "blind" || role == "helper" || role == "family" }

    @ViewBuilder private var content: some View {
        // 实名认证门禁：管理员开启且当前用户(可门控角色)尚未通过 KYC → 取代主界面，仅允许提交认证 + 紧急 + 退出。
        if session.requireVerification, gateable, !(session.user?.verified ?? false) {
            VerificationRequiredView(session: session)
        } else {
            switch role {
            // 协助者与亲友合并：同一「协助端」界面，两个角色的全部功能都在内（见 [[isAssistRole]]）。
            case "helper", "family": AssistHomeView(session: session, onSwitchRole: onSwitchRole)
            case "admin": AdminHomeView(session: session, onSwitchRole: onSwitchRole)
            case "developer": DeveloperHomeView(session: session, onSwitchRole: onSwitchRole)
            default: HubView() // 视障：功能中枢（首屏不再自动进入导盲；导盲为显式入口）
            }
        }
    }
}
