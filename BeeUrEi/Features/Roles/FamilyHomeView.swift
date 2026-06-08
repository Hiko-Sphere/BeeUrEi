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

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Toggle("接收亲人的紧急呼叫", isOn: $standby)
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
            .task { await load() }
            .refreshable { await load() }
        }
        .fullScreenCover(item: $testCall) { s in
            CallView(role: .helper, callId: s.id) { testCall = nil }
        }
    }

    private func load() async {
        guard let token = session.token else { loadError = "请先登录"; return }
        do { incoming = try await api.incomingLinks(token: token); loadError = nil }
        catch { loadError = "加载失败（需连接后端）" }
    }
}
