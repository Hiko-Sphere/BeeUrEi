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

/// 按角色分发到对应主界面。
struct RoleHomeView: View {
    let role: String
    let session: AuthSession
    let onSwitchRole: () -> Void

    var body: some View {
        switch role {
        // 协助者与亲友合并：同一「协助端」界面，两个角色的全部功能都在内（见 [[isAssistRole]]）。
        case "helper", "family": AssistHomeView(session: session, onSwitchRole: onSwitchRole)
        case "admin": AdminHomeView(session: session, onSwitchRole: onSwitchRole)
        case "developer": DeveloperHomeView(session: session, onSwitchRole: onSwitchRole)
        default: HomeView() // 视障：实时避障主界面
        }
    }
}
