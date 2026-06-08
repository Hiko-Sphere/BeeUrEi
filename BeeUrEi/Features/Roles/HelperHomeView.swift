import SwiftUI

/// 协助者（志愿者）主界面：在线待命 + 接听求助 → 通话（看对方画面 + 对讲，自己不开摄像头）。
struct HelperHomeView: View {
    let session: AuthSession
    let onSwitchRole: () -> Void

    @State private var online = false
    @State private var testCall: CallSession?
    @State private var hbTask: Task<Void, Never>?
    @State private var pollTask: Task<Void, Never>?
    @State private var incomingCall: IncomingCall?
    @State private var dismissedCallIds: Set<String> = []  // 已挂断的来电不再重复弹出（见审查 #5）

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
            .onDisappear {
                hbTask?.cancel(); hbTask = nil
                pollTask?.cancel(); pollTask = nil
                // 离开页面要显式下线，否则后端在 TTL 窗口内仍可能把已离开的人匹配给紧急求助（见审查 #7）。
                if online, let token = session.token {
                    Task { await APIClient().assistHeartbeat(token: token, available: false) }
                }
            }
        }
        .fullScreenCover(item: $testCall) { s in
            CallView(role: .helper, callId: s.id) { testCall = nil }
        }
        .fullScreenCover(item: $incomingCall) { call in
            CallView(role: .helper, callId: call.callId) {
                dismissedCallIds.insert(call.callId)  // 防止取消请求与轮询竞速时反复弹回（见审查 #5）
                if let token = session.token { Task { await APIClient().cancelCall(token: token, callId: call.callId) } }
                incomingCall = nil
            }
        }
    }

    /// "在线待命"开关 → 周期性心跳（20s）上报可用 + 轮询待接来电；关闭即下线。
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

    /// 在线期间每 3s 轮询一次待接来电；发现即弹出通话（免推送前台会合）。
    /// 仅当没有任何通话在呈现(testCall/incomingCall 均 nil)且该来电未被挂断过时才弹出，
    /// 避免与测试通话双 cover 竞态遮蔽真实来电(#9)、以及挂断后反复弹回(#5)。
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
