import SwiftUI

/// 登录设备 / 会话管理：列出本账号在各设备上的登录会话，可远程登出某台或「其它所有设备」。
/// 由账号与安全里推入。被撤销的设备其在线令牌即时失效（服务端会话存活检查）。
struct SessionsView: View {
    let token: String

    @State private var sessions: [SessionInfo] = []
    @State private var loading = true
    @State private var busy: Set<String> = []
    @State private var err: String?
    @State private var showRevokeOthers = false
    private var lang: Language { FeatureSettings().language }
    private let api = APIClient()

    var body: some View {
        List {
            if let err { Section { Text(err).foregroundStyle(Color.beeDanger) } }
            Section {
                if loading && sessions.isEmpty {
                    HStack { Spacer(); ProgressView(); Spacer() }
                } else {
                    ForEach(sessions) { s in row(s) }
                }
            } footer: {
                Text(SessionStrings.footer(lang))
            }
            if sessions.contains(where: { !$0.current }) {
                Section {
                    Button(SessionStrings.revokeOthers(lang), role: .destructive) { showRevokeOthers = true }
                        .disabled(!busy.isEmpty)
                }
            }
        }
        .navigationTitle(SessionStrings.title(lang))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog(SessionStrings.revokeOthers(lang), isPresented: $showRevokeOthers, titleVisibility: .visible) {
            Button(SessionStrings.revokeOthersConfirm(lang), role: .destructive) { Task { await revokeOthers() } }
            Button(AccountStrings.cancel(lang), role: .cancel) {}
        } message: { Text(SessionStrings.revokeOthersMessage(lang)) }
    }

    private func row(_ s: SessionInfo) -> some View {
        HStack(spacing: BeeSpacing.md) {
            Image(systemName: deviceIcon(s.deviceLabel)).font(.title3).foregroundStyle(Color.beeHoney).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(s.deviceLabel ?? SessionStrings.unknownDevice(lang)).font(.body)
                    if s.current {
                        Text(SessionStrings.current(lang)).font(.caption2.weight(.bold)).foregroundStyle(Color.beeSuccess)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(Color.beeSuccess.opacity(0.15), in: Capsule())
                    }
                }
                Text(SessionStrings.lastSeen(s.lastSeenAt, lang)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if !s.current {
                if busy.contains(s.sessionId) {
                    ProgressView()
                } else {
                    Button(SessionStrings.signOut(lang)) { Task { await revoke(s) } }
                        .font(.subheadline).foregroundStyle(Color.beeDanger)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(sessionA11y(s))
    }

    private func deviceIcon(_ label: String?) -> String {
        let l = (label ?? "").lowercased()
        if l.contains("iphone") { return "iphone" }
        if l.contains("ipad") { return "ipad" }
        if l.contains("mac") { return "laptopcomputer" }
        if l.contains("windows") { return "pc" }
        if l.contains("android") { return "candybarphone" }
        return "globe"
    }
    private func sessionA11y(_ s: SessionInfo) -> String {
        var parts = [s.deviceLabel ?? SessionStrings.unknownDevice(lang)]
        if s.current { parts.append(SessionStrings.current(lang)) }
        parts.append(SessionStrings.lastSeen(s.lastSeenAt, lang))
        return parts.joined(separator: "，")
    }

    private func load() async {
        loading = true; err = nil
        do { sessions = try await api.sessions(token: token) }
        catch { err = AccountStrings.networkError(lang) }
        loading = false
    }
    private func revoke(_ s: SessionInfo) async {
        busy.insert(s.sessionId); defer { busy.remove(s.sessionId) }
        do { try await api.revokeSession(token: token, sessionId: s.sessionId); await load() }
        catch { err = AccountStrings.networkError(lang) }
    }
    private func revokeOthers() async {
        busy.insert("others"); defer { busy.remove("others") }
        do { try await api.revokeOtherSessions(token: token); await load() }
        catch { err = AccountStrings.networkError(lang) }
    }
}

/// 登录设备 / 会话页文案（双语）。
enum SessionStrings {
    static func title(_ l: Language) -> String { l == .zh ? "登录设备" : "Devices" }
    static func footer(_ l: Language) -> String {
        l == .zh ? "这些是当前登录你账号的设备。看到不认识的设备就登出它——被登出的设备会立即失去访问权限。"
                 : "These are the devices currently signed in to your account. Sign out any you don't recognize — they lose access immediately."
    }
    static func current(_ l: Language) -> String { l == .zh ? "本机" : "This device" }
    static func unknownDevice(_ l: Language) -> String { l == .zh ? "未知设备" : "Unknown device" }
    static func signOut(_ l: Language) -> String { l == .zh ? "登出" : "Sign out" }
    static func revokeOthers(_ l: Language) -> String { l == .zh ? "登出其它所有设备" : "Sign out all other devices" }
    static func revokeOthersConfirm(_ l: Language) -> String { l == .zh ? "全部登出" : "Sign out all" }
    static func revokeOthersMessage(_ l: Language) -> String {
        l == .zh ? "除这台外，其它所有设备都会被立即登出。" : "All devices except this one will be signed out immediately."
    }
    /// 最近活动相对时间。
    static func lastSeen(_ ms: Double?, _ l: Language) -> String {
        guard let ms else { return l == .zh ? "活动时间未知" : "Last active: unknown" }
        let secs = max(0, Date().timeIntervalSince1970 - ms / 1000)
        let prefix = l == .zh ? "最近活动：" : "Last active "
        let ago: String
        if secs < 60 { ago = l == .zh ? "刚刚" : "just now" }
        else if secs < 3600 { let m = Int(secs / 60); ago = l == .zh ? "\(m) 分钟前" : "\(m) min ago" }
        else if secs < 86400 { let h = Int(secs / 3600); ago = l == .zh ? "\(h) 小时前" : "\(h) h ago" }
        else { let d = Int(secs / 86400); ago = l == .zh ? "\(d) 天前" : "\(d) d ago" }
        return prefix + ago
    }
}
