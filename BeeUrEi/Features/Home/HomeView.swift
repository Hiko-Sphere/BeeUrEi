import SwiftUI

/// 首屏：ARKit 相机预览 + 避障状态条；非 LiDAR 设备显示「设备不支持」。
struct HomeView: View {
    @State private var model = HomeViewModel()
    @State private var showSettings = false
    @State private var showRemoteAssist = false
    @State private var showNavigation = false
    @State private var showFraming = false
    @State private var showTutorial = false
    private let consentStore = ConsentStore()

    var body: some View {
        ZStack {
            content
            if DevSettings().enabled, case .running = model.state {
                DevROIOverlay(roi: model.currentROI)
                    .ignoresSafeArea()
            }
            VStack(alignment: .leading) {
                HStack {
                    helpButton
                    navButton
                    framingButton
                    Spacer()
                    settingsButton
                }
                if DevSettings().enabled { DevOverlayView(model: model) }
                Spacer()
                if case .running = model.state { statusBar }
            }
            .padding()
        }
        .task {
            model.onAppear()
            if !TutorialStore().seen { showTutorial = true }
        }
        .onDisappear { model.onDisappear() }
        .fullScreenCover(isPresented: $showTutorial) {
            TutorialView { TutorialStore().seen = true; showTutorial = false }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView(store: consentStore) { showSettings = false }
        }
        .sheet(isPresented: $showRemoteAssist) {
            RemoteAssistView { showRemoteAssist = false }
        }
        .sheet(isPresented: $showNavigation) {
            WalkNavigationView { showNavigation = false }
        }
        .fullScreenCover(isPresented: $showFraming) {
            FramingAssistView { showFraming = false }
        }
    }

    private var navButton: some View {
        Button { showNavigation = true } label: {
            Image(systemName: "figure.walk")
                .font(.title2)
                .padding(12)
                .background(.ultraThinMaterial, in: Circle())
        }
        .accessibilityLabel("步行导航")
    }

    private var helpButton: some View {
        Button { showRemoteAssist = true } label: {
            Image(systemName: "person.fill.questionmark")
                .font(.title2)
                .padding(12)
                .background(.ultraThinMaterial, in: Circle())
        }
        .accessibilityLabel("呼叫帮手")
    }

    private var framingButton: some View {
        Button { showFraming = true } label: {
            Image(systemName: "viewfinder")
                .font(.title2)
                .padding(12)
                .background(.ultraThinMaterial, in: Circle())
        }
        .accessibilityLabel("识别物体")
        .accessibilityHint("用相机对准物体，语音指引你对准并说出它是什么")
    }

    private var settingsButton: some View {
        Button { showSettings = true } label: {
            Image(systemName: "gearshape.fill")
                .font(.title2)
                .padding(12)
                .background(.ultraThinMaterial, in: Circle())
        }
        .accessibilityLabel("设置")
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .running:
            ARSessionPreviewView(session: model.arSession)
                .ignoresSafeArea()
                .accessibilityHidden(true)   // 画面对视障用户无意义，信息走状态条/语音
        case .denied:
            permissionDeniedView
        case .unsupported(let message):
            unsupportedView(message)
        case .failed(let message):
            messageView("相机出错：\(message)")
        case .idle:
            messageView("正在启动…")
        }
    }

    private var statusBar: some View {
        let highContrast = FeatureSettings().highContrast
        return VStack(spacing: 6) {
            Text(model.proximityText)
                // 高对比时用更大字号 + 蜂蜜黄；均走 Dynamic Type（系统字号设置依然生效）。
                .font(highContrast ? .system(.title, weight: .bold) : .headline)
                .foregroundStyle(highContrast ? Color(red: 1, green: 0.77, blue: 0.18) : .primary)
            if !model.advisoryText.isEmpty {
                Text(model.advisoryText)
                    .font(highContrast ? .system(.title3, weight: .semibold) : .subheadline)
                    .foregroundStyle(highContrast ? .white : .orange)
            }
        }
        .padding(highContrast ? 20 : 16)
        .frame(maxWidth: .infinity)
        .background(highContrast ? AnyShapeStyle(Color.black.opacity(0.92)) : AnyShapeStyle(.ultraThinMaterial))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(model.advisoryText.isEmpty ? model.proximityText : "\(model.proximityText)。\(model.advisoryText)")
    }

    private var permissionDeniedView: some View {
        VStack(spacing: 16) {
            Text("相机权限被关闭")
                .font(.title2).bold()
            Text("BeeUrEi 需要使用摄像头来识别前方障碍。请前往「设置」开启相机权限。")
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            Button("打开设置") { model.openSettings() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
        .padding()
    }

    private func unsupportedView(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "iphone.gen3.slash")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("设备不支持")
                .font(.title2).bold()
            Text(message)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .padding()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("设备不支持。\(message)")
    }

    private func messageView(_ text: String) -> some View {
        Text(text)
            .font(.headline)
            .multilineTextAlignment(.center)
            .padding()
    }
}

#Preview {
    HomeView()
}
