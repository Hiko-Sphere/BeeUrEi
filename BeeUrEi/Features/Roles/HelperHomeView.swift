import SwiftUI

/// 协助者（志愿者）主界面：在线待命 + 接听求助 → 通话（看对方画面 + 对讲，自己不开摄像头）。
struct HelperHomeView: View {
    let session: AuthSession
    let onSwitchRole: () -> Void

    @State private var online = false
    @State private var testCall: CallSession?
    @State private var hbTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Toggle("在线待命（接听求助）", isOn: $online)
                        .onChange(of: online) { _, on in heartbeat(on) }
                    Text(online ? "你在线，可接到求助者的视频请求。" : "你已离线，不会收到请求。")
                        .font(.footnote).foregroundStyle(.secondary)
                } header: {
                    Text("状态")
                }

                Section("通话") {
                    Button { testCall = CallSession() } label: {
                        Label("测试接听（协助者）", systemImage: "video.fill")
                    }
                    Text("接到求助时会弹出系统级来电；接通后看到对方画面（对方开启时）并语音引导。后台来电唤醒需真机 + 推送配置。")
                        .font(.footnote).foregroundStyle(.secondary)
                }

                Section("协助记录") {
                    Text("暂无记录（开发中）").foregroundStyle(.secondary)
                }

                RoleAccountSection(session: session, onSwitchRole: onSwitchRole)
            }
            .navigationTitle("协助者")
            .onDisappear { hbTask?.cancel() }
        }
        .fullScreenCover(item: $testCall) { s in
            CallView(role: .helper, callId: s.id) { testCall = nil }
        }
    }

    /// "在线待命"开关 → 周期性心跳（20s）上报可用；关闭即下线。
    private func heartbeat(_ on: Bool) {
        hbTask?.cancel(); hbTask = nil
        guard let token = session.token else { return }
        if on {
            hbTask = Task {
                while !Task.isCancelled {
                    await APIClient().assistHeartbeat(token: token, available: true)
                    try? await Task.sleep(for: .seconds(20))
                }
            }
        } else {
            Task { await APIClient().assistHeartbeat(token: token, available: false) }
        }
    }
}
