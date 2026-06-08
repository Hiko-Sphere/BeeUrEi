import SwiftUI

/// 亲友主界面：面向自己的视障亲人——绑定亲人、紧急呼叫优先接听、通话。
struct FamilyHomeView: View {
    let session: AuthSession
    let onSwitchRole: () -> Void

    @State private var standby = true
    @State private var testCall: CallSession?
    @State private var incoming: [IncomingLinkInfo] = []
    @State private var loadError: String?
    @State private var api = APIClient()
    @State private var hbTask: Task<Void, Never>?
    @State private var pollTask: Task<Void, Never>?
    @State private var incomingCall: IncomingCall?
    @State private var dismissedCallIds: Set<String> = []  // 已挂断的来电不再重复弹出（见审查 #5）

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Toggle("接收亲人的紧急呼叫", isOn: $standby)
                        .onChange(of: standby) { _, on in heartbeat(on) }
                    Text(standby ? "亲人发起紧急呼叫时会优先呼叫你。" : "已关闭，亲人紧急呼叫不会呼叫你。")
                        .font(.footnote).foregroundStyle(.secondary)
                } header: {
                    Text("待命")
                }

                Section("把你绑定为亲人的人") {
                    if let loadError {
                        Text(loadError).foregroundStyle(.secondary)
                    } else if incoming.isEmpty {
                        Text("还没有视障亲人绑定你。请让对方在 App 里按你的用户名添加。")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(incoming) { l in
                            VStack(alignment: .leading) {
                                Text(l.ownerName)
                                Text("\(l.relation)\(l.isEmergency ? " · 紧急联系人" : "")")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Section("通话") {
                    Button { testCall = CallSession() } label: {
                        Label("测试接听亲人", systemImage: "video.fill")
                    }
                    Text("接通后可看到亲人画面（对方开启时）并语音协助。")
                        .font(.footnote).foregroundStyle(.secondary)
                }

                RoleAccountSection(session: session, onSwitchRole: onSwitchRole)
            }
            .navigationTitle("亲友")
            .task { await load(); heartbeat(standby) }
            .refreshable { await load() }
            .onDisappear {
                hbTask?.cancel(); hbTask = nil
                pollTask?.cancel(); pollTask = nil
                // 离开页面要显式下线，否则后端在 TTL 窗口内仍可能把已离开的亲友匹配给紧急呼叫（见审查 #7）。
                if standby, let token = session.token {
                    Task { await APIClient().assistHeartbeat(token: token, available: false) }
                }
            }
        }
        .fullScreenCover(item: $testCall) { s in
            CallView(role: .helper, callId: s.id) { testCall = nil }
        }
        .fullScreenCover(item: $incomingCall) { call in
            CallView(role: .helper, callId: call.callId) {
                dismissedCallIds.insert(call.callId)
                if let token = session.token { Task { await APIClient().cancelCall(token: token, callId: call.callId) } }
                incomingCall = nil
            }
        }
    }

    private func load() async {
        guard let token = session.token else { loadError = "请先登录"; return }
        do { incoming = try await api.incomingLinks(token: token); loadError = nil }
        catch { loadError = "加载失败（需连接后端）" }
    }

    /// 紧急待命开关 → 周期性心跳上报可用 + 轮询待接来电（亲人紧急呼叫时前台即可接听）。
    private func heartbeat(_ on: Bool) {
        hbTask?.cancel(); hbTask = nil
        pollTask?.cancel(); pollTask = nil
        guard let token = session.token else { return }
        if on {
            hbTask = Task {
                while !Task.isCancelled {
                    await APIClient().assistHeartbeat(token: token, available: true)
                    try? await Task.sleep(for: .seconds(20))
                }
            }
            pollTask = Task { await pollIncoming(token: token) }
        } else {
            Task { await APIClient().assistHeartbeat(token: token, available: false) }
        }
    }

    /// 在线期间每 3s 轮询待接来电；仅当无通话呈现且该来电未被挂断过时才弹出（见审查 #5/#9）。
    private func pollIncoming(token: String) async {
        while !Task.isCancelled {
            if incomingCall == nil, testCall == nil,
               let calls = try? await APIClient().incomingCalls(token: token),
               let first = calls.first(where: { !dismissedCallIds.contains($0.callId) }) {
                incomingCall = first
            }
            try? await Task.sleep(for: .seconds(3))
        }
    }
}
