import SwiftUI

/// 应用内来电界面（前台手动接听，参照 WhatsApp）：先显示来电铃（接听/拒绝），
/// 用户点「接听」后再进入通话（CallView）。CallKit 接听（后台）不经此处，直接进通话。
struct IncomingCallView: View {
    let ring: IncomingRing
    let role: CallViewModel.Role
    let dismiss: () -> Void   // 清空来电态（关闭本界面）

    @State private var accepted = false
    @State private var busy = false
    @State private var pollTask: Task<Void, Never>?

    var body: some View {
        if accepted {
            // 已接听 → 进入通话；通话结束做收尾（取消会合登记 + 结束 CallKit + 清来电态）。
            CallView(role: role, callId: ring.callId) {
                if let token = KeychainStore.read() { Task { await APIClient().cancelCall(token: token, callId: ring.callId) } }
                RemoteAssistService.shared.endCall()
                dismiss()
            }
        } else {
            ringingUI
        }
    }

    private var ringingUI: some View {
        ZStack {
            Color.beeInk.ignoresSafeArea()
            VStack(spacing: BeeSpacing.lg) {
                Spacer()
                AvatarView(dataURL: ring.callerAvatar, name: ring.callerName, size: 120)
                Text(ring.callerName).font(.largeTitle.bold()).foregroundStyle(.white)
                Text("邀请你视频通话…").foregroundStyle(.white.opacity(0.85))
                Spacer()
                HStack(spacing: 72) {
                    VStack(spacing: 8) {
                        circle("phone.down.fill", .beeDanger) { decline() }
                        Text("拒绝").foregroundStyle(.white)
                    }
                    VStack(spacing: 8) {
                        circle("phone.fill", .beeSuccess) { accept() }
                        Text("接听").foregroundStyle(.white)
                    }
                }
                .padding(.bottom, 64)
            }
        }
        .task {
            A11y.announce("\(ring.callerName) 来电，双击接听或拒绝")
            startCancelWatch()
        }
        .onDisappear { pollTask?.cancel() }
    }

    private func circle(_ icon: String, _ tint: Color, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 30)).foregroundStyle(.white)
                .frame(width: 76, height: 76).background(tint, in: Circle())
        }
        .disabled(busy)
        .accessibilityLabel(icon == "phone.fill" ? "接听" : "拒绝")
    }

    private func accept() {
        guard !busy else { return }
        busy = true
        Task {
            if let token = KeychainStore.read() { await APIClient().markAnswered(token: token, callId: ring.callId) }
            accepted = true // 切换为通话界面（同一全屏呈现内，避免二次模态冲突）
        }
    }

    private func decline() {
        guard !busy else { return }
        busy = true
        Task {
            if let token = KeychainStore.read() { await APIClient().declineCall(token: token, callId: ring.callId) }
            dismiss()
        }
    }

    /// 来电方取消/超时则自动消失（避免一直响）。
    private func startCancelWatch() {
        pollTask = Task {
            while !Task.isCancelled, !accepted {
                try? await Task.sleep(for: .seconds(3))
                if accepted { break }
                guard let token = KeychainStore.read() else { continue }
                if let calls = try? await APIClient().incomingCalls(token: token),
                   !calls.contains(where: { $0.callId == ring.callId }) {
                    dismiss(); break
                }
            }
        }
    }
}
