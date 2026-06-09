import SwiftUI

/// 通话界面。视障侧：默认不发画面，按住/切换才把画面显示给对方（隐私门控）。
/// 协助者侧：看对方画面（开启时）+ 双向语音，自己不开摄像头。
struct CallView: View {
    @State private var model: CallViewModel
    @State private var showReport = false
    @Environment(\.scenePhase) private var scenePhase
    let onClose: () -> Void

    init(role: CallViewModel.Role, callId: String, onClose: @escaping () -> Void) {
        _model = State(initialValue: CallViewModel(role: role, callId: callId))
        self.onClose = onClose
    }

    var body: some View {
        VStack(spacing: 24) {
            NetworkStatusBar(callQuality: model.callQuality) // 网络类型 + 通话信号强弱

            Text(model.statusText)
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
                .accessibilityAddTraits(.updatesFrequently)

            if model.role == .blind {
                blindControls
            } else {
                #if canImport(WebRTC)
                if let engine = model.media as? WebRTCMediaEngine {
                    RemoteVideoView(engine: engine) { model.markRemoteVideoFrames() }
                        .frame(height: 320)
                        .frame(maxWidth: .infinity)
                        .background(Color.black)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(alignment: .center) {
                            // 没有真实画面帧时，叠一层说明：把"为何黑屏"讲清楚（媒体没通 / 对方没开画面）。
                            if !model.remoteVideoFrames {
                                Text(model.helperVideoHint)
                                    .font(.subheadline).foregroundStyle(.white)
                                    .multilineTextAlignment(.center).padding()
                            }
                        }
                        .accessibilityElement()
                        .accessibilityLabel(model.helperVideoHint)
                }
                #endif
                Text(model.helperVideoHint)
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(model.mediaState == .failed ? Color.beeDanger : .secondary)
                    .padding(.horizontal)
            }

            BeeBigButton("挂断", systemImage: "phone.down.fill", tint: .beeDanger, foreground: .white) {
                model.hangUp()
                onClose()
            }

            if model.canReport {
                Button("举报对方") { showReport = true }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if let status = model.reportStatus {
                Text(status).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding()
        .confirmationDialog("举报对方", isPresented: $showReport, titleVisibility: .visible) {
            ForEach(["不当行为", "言语骚扰", "诈骗或可疑", "其他"], id: \.self) { reason in
                Button(reason, role: .destructive) { Task { await model.report(reason: reason) } }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("举报会发送给管理员审核，请仅在确有问题时使用。")
        }
        .task { await model.start() }
        // 通话状态（连接中→已连接→对方离开等）变化主动朗读——焦点不在状态文字上时盲人也能听到（见无障碍审计）。
        .onChange(of: model.statusText) { _, new in A11y.announce(new) }
        // 隐私关键：切换画面外发后明确朗读结果，让盲人确认画面是否正在发送（见无障碍审计）。
        .onChange(of: model.videoSending) { _, sending in
            A11y.announce(sending ? "已开始把画面显示给对方" : "已停止显示画面")
        }
        // 通话期间让出音频会话给 WebRTC(.playAndRecord)；离开后恢复避障/导航的 .playback 会话，
        // 否则用过一次远程协助后危险警告会被 WebRTC 留下的会话置于静音开关之下（见回归 #1）。
        .onAppear { AudioSessionManager.beginCall() }
        // 隐私 fail-safe：手势被取消(来电/弹窗/进后台/手指滑出)不会触发 DragGesture.onEnded，
        // 故在离开界面与进入非活跃态时强制关闭画面外发，确保"按住才发"绝不漏成"持续发"（见审查 #1）。
        // 任意原因消失（按钮/CallKit 系统界面挂断/被其它模态顶掉）都确定性拆除媒体与信令，
        // 杜绝"用户以为已挂断但麦克风/PeerConnection 仍存活"的隐私/资源泄漏（见复审 #1）。hangUp 幂等。
        .onDisappear {
            model.hangUp()
            AudioSessionManager.endCall()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { model.setVideoSending(false) }
        }
    }

    private var blindControls: some View {
        VStack(spacing: 12) {
            Text(model.videoSending ? "正在把画面显示给对方" : "画面未发送（隐私保护）")
                .foregroundStyle(model.videoSending ? Color.beeWarn : .secondary) // 外发态用高对比警示色（见无障碍审计）

            Image(systemName: model.videoSending ? "video.fill" : "video.slash.fill")
                .font(.system(size: 56))
                .foregroundStyle(model.videoSending ? .green : .secondary)
                // 按住发送画面（防误触的刻意手势）。
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { _ in model.setVideoSending(true) }
                        .onEnded { _ in model.setVideoSending(false) }
                )
                .accessibilityHidden(true)

            Text("按住下方按钮，临时把画面显示给对方；松开即停。")
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            // 无障碍/防误触替代：明确的切换按钮（VoiceOver 可用），状态会朗读。
            BeeBigButton(model.videoSending ? "停止显示画面" : "显示画面给对方",
                         systemImage: model.videoSending ? "video.slash.fill" : "video.fill",
                         tint: model.videoSending ? .beeWarn : .beeHoney) {
                model.setVideoSending(!model.videoSending)
            }
            .accessibilityHint("开启后会把你的摄像头画面发送给协助者，请仅在需要时开启")
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
