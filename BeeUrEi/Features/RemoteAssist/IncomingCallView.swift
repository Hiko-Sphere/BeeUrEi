import SwiftUI
import UIKit // UIAccessibility.isVoiceOverRunning（盲人未开 VoiceOver 的双通道播报判定）

/// 应用内来电界面（前台手动接听，参照 WhatsApp）：先显示来电铃（接听/拒绝），
/// 用户点「接听」后再进入通话（CallView）。CallKit 接听（后台）不经此处，直接进通话。
struct IncomingCallView: View {
    let ring: IncomingRing
    let role: CallViewModel.Role
    let dismiss: () -> Void   // 清空来电态（关闭本界面）

    @State private var accepted = false
    @State private var busy = false
    @State private var pollTask: Task<Void, Never>?
    @State private var pulsing = false // 头像呼吸光环（来电中）
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// 来电屏文案语言（E5）。
    private var lang: Language { FeatureSettings().language }

    /// 双路播报：VoiceOver 走系统公告；盲人未开 VoiceOver 时用 App TTS（A11y.announce 未开 VO 会被静默丢弃，见无障碍审计）。
    /// 仅盲人角色发声——协助者（收到盲人求助来电）看屏即可，不受 TTS 打扰。
    private func announce(_ text: String) {
        A11y.announce(text)
        if role == .blind, !UIAccessibility.isVoiceOverRunning {
            SpeechHub.shared.speak(text, channel: .call, voiceCode: lang.voiceCode)
        }
    }

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
            // 墨蓝纵向渐变背景（沉稳精致，类系统来电）。
            LinearGradient(colors: [Color.beeInk, Color.beeInk.opacity(0.82), Color(red: 0.05, green: 0.06, blue: 0.10)],
                           startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            VStack(spacing: BeeSpacing.lg) {
                Spacer()
                // 来电中头像带蜂蜜色呼吸光环；开了「减弱动态效果」则静态光环。
                AvatarView(dataURL: ring.callerAvatar, name: ring.callerName, size: 120)
                    .background(
                        Circle().stroke(Color.beeHoney.opacity(pulsing ? 0.0 : 0.55), lineWidth: 3)
                            .scaleEffect(pulsing ? 1.45 : 1.05)
                    )
                    .onAppear {
                        guard !reduceMotion else { return }
                        withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { pulsing = true }
                    }
                Text(ring.callerName).font(.largeTitle.bold()).foregroundStyle(.white)
                Text(CallStrings.incomingCallSubtitle(lang))
                    .font(.headline).foregroundStyle(.white.opacity(0.75))
                Spacer()
                HStack(spacing: 72) {
                    VStack(spacing: 10) {
                        circle("phone.down.fill", .beeDanger) { decline() }
                        Text(CallStrings.decline(lang)).font(.subheadline).foregroundStyle(.white.opacity(0.9))
                    }
                    VStack(spacing: 10) {
                        circle("phone.fill", .beeSuccess) { accept() }
                        Text(CallStrings.answer(lang)).font(.subheadline).foregroundStyle(.white.opacity(0.9))
                    }
                }
                .padding(.bottom, 64)
            }
        }
        .task {
            ScreenWake.acquire("ring")   // 响铃期间屏不灭，盲人有充足时间接听
            // 来电即报**谁**来电（双路，未开 VoiceOver 的盲人也须听到是谁——否则只闻铃声不知该不该接、是不是家人急事）。
            announce(CallStrings.incomingRingAnnounce(ring.callerName, lang))
            startCancelWatch()
        }
        // VoiceOver 魔法轻点（双指双击）= 接听（系统来电惯例）。
        .accessibilityAction(.magicTap) { accept() }
        .onDisappear { pollTask?.cancel(); ScreenWake.release("ring") }
    }

    private func circle(_ icon: String, _ tint: Color, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 30, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 78, height: 78)
                .background(tint, in: Circle())
                .overlay(Circle().strokeBorder(.white.opacity(0.18), lineWidth: 0.5))
                .shadow(color: tint.opacity(0.45), radius: 12, y: 6)
        }
        .buttonStyle(BeePressStyle())
        .disabled(busy)
        .accessibilityLabel(icon == "phone.fill" ? CallStrings.answer(lang) : CallStrings.decline(lang))
    }

    private func accept() {
        guard !busy else { return }
        busy = true
        Task {
            // 群呼首接抢占：没抢到则明确告知并退出，而不是加入失败的房间。
            if let token = KeychainStore.read() {
                let outcome = await APIClient().markAnswered(token: token, callId: ring.callId)
                guard outcome == .won else {
                    // gone=呼叫已结束/过期（无人接）；否则=被别人接走。措辞如实。
                    // gone=呼叫已结束/过期；否则被别人接走。双路播报（未开 VoiceOver 的盲人也须听到解释，否则来电屏骤然收起无缘由）。
                    let msg = outcome == .gone ? CallStrings.callEnded(lang) : CallStrings.answeredElsewhere(lang)
                    announce(msg)
                    dismiss()
                    return
                }
            }
            IncomingCallCenter.shared.answeredRinging() // 停铃+撤超时（ringing 保留以驱动本全屏）
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
    /// 轮询 1s：主叫挂断后铃声/振动须尽快停（3s 间隔曾导致"对方已挂断还在震"，见用户反馈）。
    private func startCancelWatch() {
        pollTask = Task {
            while !Task.isCancelled, !accepted {
                try? await Task.sleep(for: .seconds(1))
                if accepted { break }
                guard let token = KeychainStore.read() else { continue }
                if let calls = try? await APIClient().incomingCalls(token: token),
                   !calls.contains(where: { $0.callId == ring.callId }) {
                    IncomingCallCenter.shared.clear() // 立即停铃停振（不等 dismiss 链路兜转）
                    dismiss(); break
                }
            }
        }
    }
}
