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

    init(role: CallViewModel.Role, callId: String, waitingText: String = "正在接通，请稍候…", onClose: @escaping () -> Void) {
        _model = State(initialValue: CallViewModel(role: role, callId: callId, waitingText: waitingText))
        self.onClose = onClose
    }

    var body: some View {
        Group {
            if model.role == .helper { helperFullScreen } else { blindLayout }
        }
        .confirmationDialog("举报对方", isPresented: $showReport, titleVisibility: .visible) {
            ForEach(["不当行为", "言语骚扰", "诈骗或可疑", "其他"], id: \.self) { reason in
                Button(reason, role: .destructive) { Task { await model.report(reason: reason) } }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("举报会发送给管理员审核，请仅在确有问题时使用。")
        }
        // 防呆：盲人挂断/静音需二次确认，避免摸索手机时误触（取消静音可立即生效）。
        .alert("确认挂断通话？", isPresented: $showHangupConfirm) {
            Button("挂断", role: .destructive) { model.hangUp(); onClose() }
            Button("继续通话", role: .cancel) {}
        }
        .alert("确认静音？", isPresented: $showMuteConfirm) {
            Button("静音", role: .destructive) { model.setMuted(true) }
            Button("取消", role: .cancel) {}
        } message: { Text("静音后对方将暂时听不到你的声音。") }
        .task { await model.start() }
        .onChange(of: model.statusText) { _, new in A11y.announce(new) }
        .onChange(of: model.videoSending) { _, sending in
            A11y.announce(sending ? "已开始把画面显示给对方" : "已停止显示画面")
        }
        .onChange(of: model.muted) { _, m in A11y.announce(m ? "已静音，对方听不到你" : "已取消静音") }
        .onChange(of: model.cameraFront) { _, f in A11y.announce(f ? "已切换到前置摄像头，对方将看到你的脸" : "已切换到后置摄像头，对方看到你面前的情况") }
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
            VStack(spacing: 6) {
                NetworkStatusBar(callQuality: model.callQuality)
                Text(model.statusText).font(.subheadline.weight(.medium))
                    .foregroundStyle(model.declined ? Color.beeDanger : .white)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            .padding().frame(maxWidth: .infinity).background(.black.opacity(0.35))

            Spacer()

            VStack(spacing: BeeSpacing.md) {
                HStack(spacing: 48) {
                    circleButton(model.muted ? "mic.slash.fill" : "mic.fill",
                                 label: model.muted ? "取消静音" : "静音",
                                 tint: model.muted ? Color.beeWarn : Color.white.opacity(0.25)) {
                        model.setMuted(!model.muted); scheduleAutoHide()
                    }
                    circleButton("phone.down.fill", label: "挂断", tint: Color.beeDanger) {
                        model.hangUp(); onClose()
                    }
                }
                if model.canReport {
                    HStack(spacing: BeeSpacing.lg) {
                        Button("加为亲友") { Task { await model.addPeerAsFriend() }; scheduleAutoHide() }
                        Button("拉黑", role: .destructive) { Task { await model.blockPeer() }; scheduleAutoHide() }
                        Button("举报") { showReport = true }
                    }
                    .font(.footnote).foregroundStyle(.white)
                }
            }
            .padding(.bottom, 40).padding(.horizontal)
            .frame(maxWidth: .infinity).background(.black.opacity(0.35))
        }
    }

    private func circleButton(_ icon: String, label: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.title2).foregroundStyle(.white)
                .frame(width: 64, height: 64).background(tint, in: Circle())
        }
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

            HStack(spacing: BeeSpacing.md) {
                BeeBigButton(model.muted ? "取消静音" : "静音",
                             systemImage: model.muted ? "mic.slash.fill" : "mic.fill",
                             tint: model.muted ? .beeWarn : .beeInk, foreground: .white) {
                    if model.muted { model.setMuted(false) } else { showMuteConfirm = true } // 静音需确认，取消静音立即
                }
                BeeBigButton("挂断", systemImage: "phone.down.fill", tint: .beeDanger, foreground: .white) {
                    showHangupConfirm = true // 防呆：二次确认
                }
                .accessibilityHint("挂断需再次确认，避免误触")
            }

            if model.canReport {
                HStack(spacing: BeeSpacing.lg) {
                    Button("加为亲友/协助者") { Task { await model.addPeerAsFriend() } }
                    Button("拉黑对方", role: .destructive) { Task { await model.blockPeer() } }
                    Button("举报对方") { showReport = true }
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
            Text(model.videoSending
                 ? (model.cameraFront ? "正在显示前置摄像头（你的面部）给对方" : "正在显示后置摄像头（你面前的情况）给对方")
                 : "画面未发送（隐私保护）")
                .foregroundStyle(model.videoSending ? Color.beeWarn : .secondary)
                .multilineTextAlignment(.center)

            // 无障碍/防误触：明确的切换按钮（VoiceOver 可用），状态会朗读。
            BeeBigButton(model.videoSending ? "停止显示画面" : "显示画面给对方",
                         systemImage: model.videoSending ? "video.slash.fill" : "video.fill",
                         tint: model.videoSending ? .beeWarn : .beeHoney) {
                model.setVideoSending(!model.videoSending)
            }
            .accessibilityHint("开启后会把你的摄像头画面发送给协助者；可在下方选择后置(看你面前)或前置(看你的脸)")

            // 前/后摄像头选择（分享时可切）。
            if model.videoSending {
                Picker("摄像头", selection: Binding(get: { model.cameraFront }, set: { model.setCameraFront($0) })) {
                    Text("后置（看前方）").tag(false)
                    Text("前置（看面部）").tag(true)
                }
                .pickerStyle(.segmented)
                .accessibilityLabel("选择摄像头：后置看你面前的情况，前置让对方看到你的脸")
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
