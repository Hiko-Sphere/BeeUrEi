import SwiftUI
import UIKit

/// 通话界面。视障侧：默认不发画面，主动选择才把后置摄像头画面显示给对方（隐私门控）+ 静音/挂断防呆。
/// 协助者侧：全屏视频（类 FaceTime），轻点显隐控件 + 静音/挂断。
struct CallView: View {
    @State private var model: CallViewModel
    @State private var showReport = false
    @State private var showHangupConfirm = false   // 盲人挂断防呆
    @State private var showMuteConfirm = false      // 盲人静音防呆（取消静音不需确认）
    @State private var controlsVisible = true       // 协助者全屏控件显隐
    @State private var autoHide: Task<Void, Never>?
    @Environment(\.scenePhase) private var scenePhase
    let onClose: () -> Void
    /// A4：呼叫亲友无人接听/被拒时的「改为向志愿者求助」回退（仅盲人呼亲友的路径传入）。
    var onFallbackToVolunteer: (() -> Void)?
    /// 通话屏文案语言（E5）。
    private var lang: Language { FeatureSettings().language }

    init(role: CallViewModel.Role, callId: String,
         waitingText: String = CallStrings.defaultWaiting(FeatureSettings().language),
         onFallbackToVolunteer: (() -> Void)? = nil, onClose: @escaping () -> Void) {
        _model = State(initialValue: CallViewModel(role: role, callId: callId, waitingText: waitingText))
        self.onFallbackToVolunteer = onFallbackToVolunteer
        self.onClose = onClose
    }

    var body: some View {
        Group {
            if model.role == .helper { helperFullScreen } else { blindLayout }
        }
        .confirmationDialog(CallStrings.reportDialogTitle(lang), isPresented: $showReport, titleVisibility: .visible) {
            ForEach(CallStrings.reportReasons(lang), id: \.self) { reason in
                Button(reason, role: .destructive) { Task { await model.report(reason: reason) } }
            }
            Button(CallStrings.cancel(lang), role: .cancel) {}
        } message: {
            Text(CallStrings.reportDialogMessage(lang))
        }
        // 防呆：盲人挂断/静音需二次确认，避免摸索手机时误触（取消静音可立即生效）。
        .alert(CallStrings.hangupConfirmTitle(lang), isPresented: $showHangupConfirm) {
            Button(CallStrings.hangup(lang), role: .destructive) { model.hangUp(); onClose() }
            Button(CallStrings.continueCall(lang), role: .cancel) {}
        }
        .alert(CallStrings.muteConfirmTitle(lang), isPresented: $showMuteConfirm) {
            Button(CallStrings.mute(lang), role: .destructive) { model.setMuted(true) }
            Button(CallStrings.cancel(lang), role: .cancel) {}
        } message: { Text(CallStrings.muteConfirmMessage(lang)) }
        .task { await model.start() }
        .onChange(of: model.statusText) { _, new in A11y.announce(new) }
        .onChange(of: model.videoSending) { _, sending in
            A11y.announce(CallStrings.announceVideo(sending: sending, lang))
        }
        .onChange(of: model.muted) { _, m in A11y.announce(CallStrings.announceMuted(m, lang)) }
        .onChange(of: model.cameraFront) { _, f in A11y.announce(CallStrings.announceCamera(front: f, lang)) }
        // VoiceOver 魔法轻点（双指双击）= 挂断（系统通话惯例）；盲人侧仍走二次确认防呆。
        .accessibilityAction(.magicTap) {
            if model.role == .blind { showHangupConfirm = true } else { model.hangUp(); onClose() }
        }
        // 一方挂断 → 对方自动挂断并关闭界面。
        .onChange(of: model.callEnded) { _, ended in if ended { onClose() } }
        .onChange(of: model.reportStatus) { _, s in if let s, !s.isEmpty { A11y.announce(s) } }
        .onAppear { AudioSessionManager.beginCall() }
        .onDisappear { autoHide?.cancel(); model.hangUp(); AudioSessionManager.endCall() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { model.setVideoSending(false) }
        }
    }

    // MARK: 协助者：全屏视频 + 轻点显隐控件（类 FaceTime）

    private var helperFullScreen: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            #if canImport(WebRTC)
            if let engine = model.media as? WebRTCMediaEngine {
                RemoteVideoView(engine: engine) { model.markRemoteVideoFrames() }
                    .ignoresSafeArea()
                    .accessibilityElement()
                    .accessibilityLabel(model.helperVideoHint)
            }
            #endif
            // 还没有真实画面帧时，居中显示头像 + 原因说明。
            if !model.remoteVideoFrames {
                VStack(spacing: 14) {
                    if let name = model.peerName, !name.isEmpty {
                        AvatarView(dataURL: model.peerAvatar, name: name, size: 96)
                        Text(name).font(.headline).foregroundStyle(.white)
                    }
                    Text(model.helperVideoHint)
                        .font(.subheadline).foregroundStyle(.white.opacity(0.9))
                        .multilineTextAlignment(.center).padding(.horizontal, 32)
                }
            }
            if controlsVisible { helperControlsOverlay.transition(.opacity) }
        }
        .contentShape(Rectangle())
        .onTapGesture { toggleControls() }
        .onAppear { scheduleAutoHide() }
        .statusBarHidden(controlsVisible == false)
    }

    private var helperControlsOverlay: some View {
        VStack {
            // 顶部渐隐遮罩（类 FaceTime）：信息浮于画面之上而不压一块生硬黑条。
            VStack(spacing: 6) {
                NetworkStatusBar(callQuality: model.callQuality)
                HStack(spacing: 8) {
                    if let name = model.peerName, !name.isEmpty, model.remoteVideoFrames {
                        AvatarView(dataURL: model.peerAvatar, name: name, size: 24)
                        Text(name).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                    }
                    Text(model.statusText).font(.subheadline.weight(.medium))
                        .foregroundStyle(model.declined ? Color.beeDanger : .white.opacity(0.9))
                        .accessibilityAddTraits(.updatesFrequently)
                }
            }
            .padding(.horizontal).padding(.top, 8).padding(.bottom, 28)
            .frame(maxWidth: .infinity)
            .background(LinearGradient(colors: [.black.opacity(0.62), .clear], startPoint: .top, endPoint: .bottom))

            Spacer()

            // 底部渐隐遮罩 + 控件。
            VStack(spacing: BeeSpacing.md) {
                // 远程控制（对方画面已出时）：暗光开对方手电筒 / 变焦放大看细节（Be My Eyes 式）。
                if model.remoteVideoFrames {
                    HStack(spacing: 32) {
                        circleButton(model.remoteTorchOn ? "flashlight.on.fill" : "flashlight.off.fill",
                                     label: CallStrings.remoteTorch(on: model.remoteTorchOn, lang),
                                     tint: model.remoteTorchOn ? Color.beeWarn : Color.white.opacity(0.22)) {
                            model.toggleRemoteTorch(); scheduleAutoHide()
                        }
                        Button {
                            model.cycleRemoteZoom(); scheduleAutoHide()
                        } label: {
                            Text("\(Int(model.remoteZoom))x").font(.headline).foregroundStyle(.white)
                                .frame(width: 64, height: 64)
                                .background(model.remoteZoom > 1 ? Color.beeWarn : Color.white.opacity(0.22), in: Circle())
                                .overlay(Circle().strokeBorder(.white.opacity(0.18), lineWidth: 0.5))
                        }
                        .buttonStyle(BeePressStyle())
                        .accessibilityLabel(CallStrings.zoomA11y(Int(model.remoteZoom), lang))
                    }
                }
                HStack(spacing: 48) {
                    circleButton(model.muted ? "mic.slash.fill" : "mic.fill",
                                 label: model.muted ? CallStrings.unmute(lang) : CallStrings.mute(lang),
                                 tint: model.muted ? Color.beeWarn : Color.white.opacity(0.22)) {
                        model.setMuted(!model.muted); scheduleAutoHide()
                    }
                    circleButton("phone.down.fill", label: CallStrings.hangup(lang), tint: Color.beeDanger) {
                        model.hangUp(); onClose()
                    }
                }
                if model.canReport {
                    HStack(spacing: BeeSpacing.lg) {
                        Button(CallStrings.addFriendShort(lang)) { Task { await model.addPeerAsFriend() }; scheduleAutoHide() }
                        Button(CallStrings.blockShort(lang), role: .destructive) { Task { await model.blockPeer() }; scheduleAutoHide() }
                        Button(CallStrings.reportShort(lang)) { showReport = true }
                    }
                    .font(.footnote).foregroundStyle(.white.opacity(0.9))
                }
            }
            .padding(.top, 36).padding(.bottom, 40).padding(.horizontal)
            .frame(maxWidth: .infinity)
            .background(LinearGradient(colors: [.clear, .black.opacity(0.66)], startPoint: .top, endPoint: .bottom))
        }
        .ignoresSafeArea(edges: [.top, .bottom])
    }

    private func circleButton(_ icon: String, label: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.title2).foregroundStyle(.white)
                .frame(width: 64, height: 64)
                .background(tint, in: Circle())
                .overlay(Circle().strokeBorder(.white.opacity(0.18), lineWidth: 0.5))
        }
        .buttonStyle(BeePressStyle())
        .accessibilityLabel(label)
    }

    private func toggleControls() {
        withAnimation { controlsVisible.toggle() }
        if controlsVisible { scheduleAutoHide() } else { autoHide?.cancel() }
    }

    /// 4 秒后自动隐藏控件（VoiceOver 运行时不隐藏，保证可达）。
    private func scheduleAutoHide() {
        autoHide?.cancel()
        guard !UIAccessibility.isVoiceOverRunning else { return }
        autoHide = Task {
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled { withAnimation { controlsVisible = false } }
        }
    }

    // MARK: 视障者：控件为主 + 静音/挂断防呆

    private var blindLayout: some View {
        VStack(spacing: 20) {
            NetworkStatusBar(callQuality: model.callQuality)
            if let name = model.peerName, !name.isEmpty {
                AvatarView(dataURL: model.peerAvatar, name: name, size: 96)
                Text(name).font(.headline)
            }
            Text(model.statusText)
                .font(.title3.weight(.semibold)).multilineTextAlignment(.center)
                .foregroundStyle(model.declined ? Color.beeDanger : .primary)
                .accessibilityAddTraits(.updatesFrequently)

            blindControls // 是否开启后置摄像头让协助者看到（隐私门控）

            // A4：无人接听/被拒 → 一键转向公开志愿者求助（不让盲人卡死在没人接的呼叫里）。
            if (model.unanswered || model.declined), let fallback = onFallbackToVolunteer {
                BeeBigButton(CallStrings.fallbackTitle(lang), systemImage: "hand.raised.fill",
                             subtitle: CallStrings.fallbackSubtitle(lang), tint: .beeHoney) {
                    model.hangUp()
                    fallback()
                }
            }

            HStack(spacing: BeeSpacing.md) {
                BeeBigButton(model.muted ? CallStrings.unmute(lang) : CallStrings.mute(lang),
                             systemImage: model.muted ? "mic.slash.fill" : "mic.fill",
                             tint: model.muted ? .beeWarn : .beeInk, foreground: .white) {
                    if model.muted { model.setMuted(false) } else { showMuteConfirm = true } // 静音需确认，取消静音立即
                }
                BeeBigButton(CallStrings.hangup(lang), systemImage: "phone.down.fill", tint: .beeDanger, foreground: .white) {
                    showHangupConfirm = true // 防呆：二次确认
                }
                .accessibilityHint(CallStrings.hangupHint(lang))
            }

            if model.canReport {
                HStack(spacing: BeeSpacing.lg) {
                    Button(CallStrings.addFriendLong(lang)) { Task { await model.addPeerAsFriend() } }
                    Button(CallStrings.blockLong(lang), role: .destructive) { Task { await model.blockPeer() } }
                    Button(CallStrings.reportLong(lang)) { showReport = true }
                }
                .font(.subheadline)
            }
            if let status = model.reportStatus {
                Text(status).font(.footnote).foregroundStyle(.secondary)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .padding()
    }

    private var blindControls: some View {
        VStack(spacing: 12) {
            Text(CallStrings.videoStatus(sending: model.videoSending, front: model.cameraFront, lang))
                .foregroundStyle(model.videoSending ? Color.beeWarn : .secondary)
                .multilineTextAlignment(.center)

            // 无障碍/防误触：明确的切换按钮（VoiceOver 可用），状态会朗读。
            BeeBigButton(model.videoSending ? CallStrings.stopVideo(lang) : CallStrings.showVideo(lang),
                         systemImage: model.videoSending ? "video.slash.fill" : "video.fill",
                         tint: model.videoSending ? .beeWarn : .beeHoney) {
                model.setVideoSending(!model.videoSending)
            }
            .accessibilityHint(CallStrings.showVideoHint(lang))

            // 前/后摄像头选择（分享时可切）。
            if model.videoSending {
                Picker(CallStrings.cameraPicker(lang),
                       selection: Binding(get: { model.cameraFront }, set: { model.setCameraFront($0) })) {
                    Text(CallStrings.cameraRear(lang)).tag(false)
                    Text(CallStrings.cameraFront(lang)).tag(true)
                }
                .pickerStyle(.segmented)
                .accessibilityLabel(CallStrings.cameraPickerA11y(lang))
            }
        }
    }
}

#if canImport(WebRTC)
import WebRTC

/// 渲染远端视频（协助者侧）。需 stasel/WebRTC 包。
/// onFrames：真正收到非零尺寸画面帧时回调一次——用于把"已连通但对方没开画面/黑屏"与"真有画面"区分开。
struct RemoteVideoView: UIViewRepresentable {
    let engine: WebRTCMediaEngine
    let onFrames: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFrames: onFrames) }

    func makeUIView(context: Context) -> RTCMTLVideoView {
        let view = RTCMTLVideoView()
        view.videoContentMode = .scaleAspectFill
        view.delegate = context.coordinator
        engine.setRemoteRenderer(view)
        return view
    }
    func updateUIView(_ uiView: RTCMTLVideoView, context: Context) {}

    final class Coordinator: NSObject, RTCVideoViewDelegate {
        private let onFrames: () -> Void
        private var reported = false
        init(onFrames: @escaping () -> Void) { self.onFrames = onFrames }
        func videoView(_ videoView: RTCVideoRenderer, didChangeVideoSize size: CGSize) {
            guard !reported, size.width > 0, size.height > 0 else { return } // 非零尺寸=真有画面帧
            reported = true
            DispatchQueue.main.async { self.onFrames() }
        }
    }
}
#endif
