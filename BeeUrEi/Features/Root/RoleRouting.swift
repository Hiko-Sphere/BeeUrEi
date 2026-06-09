import SwiftUI

func roleDisplayName(_ role: String) -> String {
    switch role {
    case "blind": return "求助者（视障）"
    case "helper": return "协助者"
    case "family": return "亲友"
    case "admin": return "管理员"
    case "developer": return "开发者"
    default: return role
    }
}

/// 协助端角色（协助者 / 亲友）：合并后共用同一套界面，同时具备
/// 「帮助陌生人（志愿者队列+匹配）」与「帮助我绑定的亲人」全部功能。
func isAssistRole(_ role: String) -> Bool { role == "helper" || role == "family" }

/// 各角色界面通用「账号」区：查看账号、切换角色、退出登录。
struct RoleAccountSection: View {
    let session: AuthSession
    let onSwitchRole: () -> Void

    var body: some View {
        Section("账号") {
            if let u = session.user {
                LabeledContent("用户", value: u.displayName)
                LabeledContent("角色", value: roleDisplayName(u.role))
            }
            Button("切换角色") { onSwitchRole() }
            Button("退出登录", role: .destructive) { session.logout() }
        }
    }
}

/// 登录后**确认角色**再进入。开发者可选任一角色界面（测试）。
struct RoleEntryView: View {
    let account: AccountInfo
    let session: AuthSession
    let onEnter: (String) -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "person.crop.circle.badge.checkmark")
                .font(.system(size: 56)).foregroundStyle(.tint)
            Text("你好，\(account.displayName)").font(.title2).bold()
            Text("账号角色：\(roleDisplayName(account.role))").foregroundStyle(.secondary)

            if account.role == "developer" {
                Text("开发者：选择以哪个角色界面进入").font(.subheadline)
                // helper 即合并后的协助端（含原 family 全部功能），故不再单列 family。
                ForEach(["blind", "helper", "admin", "developer"], id: \.self) { r in
                    Button("以 \(roleDisplayName(r)) 进入") { onEnter(r) }
                        .buttonStyle(.bordered).controlSize(.large)
                }
            } else {
                Button("以 \(roleDisplayName(account.role)) 身份进入") { onEnter(account.role) }
                    .buttonStyle(.borderedProminent).controlSize(.large)
            }

            Button("退出登录", role: .destructive) { session.logout() }.padding(.top)
        }
        .padding()
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
