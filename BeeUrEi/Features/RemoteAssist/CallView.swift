import SwiftUI

/// 通话界面。视障侧：默认不发画面，按住/切换才把画面显示给对方（隐私门控）。
/// 协助者侧：看对方画面（开启时）+ 双向语音，自己不开摄像头。
struct CallView: View {
    @State private var model: CallViewModel
    let onClose: () -> Void

    init(role: CallViewModel.Role, callId: String, onClose: @escaping () -> Void) {
        _model = State(initialValue: CallViewModel(role: role, callId: callId))
        self.onClose = onClose
    }

    var body: some View {
        VStack(spacing: 24) {
            Text(model.statusText)
                .font(.headline)
                .multilineTextAlignment(.center)

            if model.role == .blind {
                blindControls
            } else {
                #if canImport(WebRTC)
                if let engine = model.media as? WebRTCMediaEngine {
                    RemoteVideoView(engine: engine)
                        .frame(height: 320)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .accessibilityHidden(true)
                }
                #endif
                Text("协助者模式：对方开启画面时这里显示其摄像头画面，并可与对方语音交流。")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
            }

            Button(role: .destructive) {
                model.hangUp()
                onClose()
            } label: {
                Label("挂断", systemImage: "phone.down.fill")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding()
        .task { await model.start() }
    }

    private var blindControls: some View {
        VStack(spacing: 12) {
            Text(model.videoSending ? "正在把画面显示给对方" : "画面未发送（隐私保护）")
                .foregroundStyle(model.videoSending ? .green : .secondary)

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
            Button(model.videoSending ? "停止显示画面" : "显示画面给对方") {
                model.setVideoSending(!model.videoSending)
            }
            .buttonStyle(.bordered)
            .accessibilityHint("开启后会把你的摄像头画面发送给协助者，请仅在需要时开启")
        }
    }
}

#if canImport(WebRTC)
import WebRTC

/// 渲染远端视频（协助者侧）。需 stasel/WebRTC 包。
struct RemoteVideoView: UIViewRepresentable {
    let engine: WebRTCMediaEngine
    func makeUIView(context: Context) -> RTCMTLVideoView {
        let view = RTCMTLVideoView()
        view.videoContentMode = .scaleAspectFill
        engine.setRemoteRenderer(view)
        return view
    }
    func updateUIView(_ uiView: RTCMTLVideoView, context: Context) {}
}
#endif
