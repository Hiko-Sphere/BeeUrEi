import SwiftUI
import UIKit

/// 视障首屏（重设计）：ARKit 相机在后台做避障；前台是**大字高对比**的状态条与超大带标签按钮。
/// 设计原则：信息走语音/状态条；操作件超大、有文字标签、VoiceOver 友好；首要操作「求助」最突出。
struct HomeView: View {
    @State private var model = HomeViewModel()
    @State private var showSettings = false
    @State private var showRemoteAssist = false
    @State private var showNavigation = false
    @State private var showFraming = false
    @State private var showTutorial = false
    @State private var locationDescriber = LocationDescriber()
    @State private var idleTask: Task<Void, Never>? // 屏幕常亮计时（到时允许系统息屏）
    @State private var incoming = IncomingCallCenter.shared // 监听来电（接听别人的呼叫经此在根层呈现）
    private let consentStore = ConsentStore()

    var body: some View {
        ZStack {
            content
            if DevSettings().enabled, case .running = model.state {
                DevROIOverlay(roi: model.currentROI)
                    .ignoresSafeArea()
            }
            VStack(spacing: BeeSpacing.md) {
                HStack(alignment: .top) {
                    if case .running = model.state { statusBanner } else { Spacer() }
                    settingsButton
                }
                if DevSettings().enabled { DevOverlayView(model: model) }
                Spacer()
                // 仅相机运行时显示底部操作面板：否则会与「相机权限被关闭/设备不支持」等居中提示重叠，
                // 且会把依赖相机的「看一看」等暴露为可点（见审查 #5）。求助按钮在权限页另行提供。
                if case .running = model.state { actionPanel }
            }
            .padding()
        }
        .task {
            model.onAppear()
            applyKeepAwake()
            if !TutorialStore().seen { showTutorial = true }
        }
        .onDisappear { model.onDisappear(); releaseKeepAwake() }
        .fullScreenCover(isPresented: $showTutorial) {
            TutorialView { TutorialStore().seen = true; showTutorial = false }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView(store: consentStore) { showSettings = false }
        }
        .onChange(of: showSettings) { _, shown in if !shown { applyKeepAwake() } } // 设置可能改了常亮时长，返回时重新应用
        // 接到别人来电(铃响或已接入)：暂停避障(停语音/帧/声呐) + 强制常亮 + 关掉本页其它模态(否则根层来电界面弹不出来，见来电链路深审 #1/#3)。
        .onChange(of: incoming.hasIncoming) { _, inCall in
            if inCall {
                model.pauseSession(); forceKeepAwake()
                showSettings = false; showRemoteAssist = false; showNavigation = false; showFraming = false; showTutorial = false
            } else {
                model.resumeSession(); applyKeepAwake()
            }
        }
        // 求助/取景界面也用相机：呈现时暂停主页避障会话+强制常亮(通话期间不息屏)，关闭返回时恢复。
        .onChange(of: showRemoteAssist) { _, shown in
            if shown { model.pauseSession(); forceKeepAwake() } else { model.resumeSession(); applyKeepAwake() }
        }
        .onChange(of: showFraming) { _, shown in
            if shown { model.pauseSession(); forceKeepAwake() } else { model.resumeSession(); applyKeepAwake() }
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

    // MARK: 屏幕常亮（省电设置）

    /// 按设置应用屏幕常亮：先常亮；若设了时长，则到时允许系统自动息屏（息屏后避障暂停，省电）。
    private func applyKeepAwake() {
        idleTask?.cancel()
        UIApplication.shared.isIdleTimerDisabled = true
        let secs = FeatureSettings().keepAwakeSeconds
        guard secs > 0 else { return } // 0 = 永久不息屏
        idleTask = Task {
            try? await Task.sleep(for: .seconds(Double(secs)))
            if !Task.isCancelled { UIApplication.shared.isIdleTimerDisabled = false }
        }
    }

    /// 通话/取景期间强制常亮（不让其在使用中息屏）。
    private func forceKeepAwake() {
        idleTask?.cancel(); idleTask = nil
        UIApplication.shared.isIdleTimerDisabled = true
    }

    /// 离开主页：交还系统息屏控制（避免影响其它界面）。
    private func releaseKeepAwake() {
        idleTask?.cancel(); idleTask = nil
        UIApplication.shared.isIdleTimerDisabled = false
    }

    // MARK: 底部大按钮面板

    private var actionPanel: some View {
        VStack(spacing: BeeSpacing.sm) {
            // 首要操作：求助（最大、蜂蜜黄）
            BeeBigButton("求助", systemImage: "hand.raised.fill",
                         subtitle: "呼叫志愿者或亲友帮你看", tint: .beeHoney) {
                showRemoteAssist = true
            }
            HStack(spacing: BeeSpacing.sm) {
                tile("步行导航", systemImage: "figure.walk") { showNavigation = true }
                tile("看一看", systemImage: "viewfinder",
                     hint: "用相机对准物体，语音说出它是什么") { showFraming = true }
            }
            HStack(spacing: BeeSpacing.sm) {
                tile("我在哪", systemImage: "location.fill",
                     hint: "播报你当前位置和附近的地点") { locationDescriber.describe() }
                tile("设置", systemImage: "gearshape.fill") { showSettings = true }
            }
        }
    }

    /// 方块磁贴按钮：深底白字 + 蜂蜜黄图标，保证在任意相机画面上都清晰可读；超大点按区。
    private func tile(_ title: String, systemImage: String, hint: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: BeeSpacing.sm) {
                Image(systemName: systemImage).font(.system(size: 30, weight: .bold)).foregroundStyle(Color.beeHoney)
                Text(title).font(.headline).foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity, minHeight: 92)
            .background(Color.beeInk.opacity(0.88), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .modifier(OptionalA11yHint(hint: hint))
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
            stateMessageView("相机出错：\(message)", showHelp: true)
        case .idle:
            messageView("正在启动…")
        }
    }

    /// 求助入口兜底：相机不可用（设备不支持/出错）时，求助不依赖相机，仍让视障用户能呼叫。
    private var helpFallbackButton: some View {
        Button("呼叫帮手") { showRemoteAssist = true }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
    }

    private var statusBanner: some View {
        let highContrast = FeatureSettings().highContrast
        return VStack(alignment: .leading, spacing: 6) {
            Text(model.proximityText)
                .font(highContrast ? .system(.title, weight: .bold) : .system(.title2, weight: .bold))
                .foregroundStyle(highContrast ? Color.beeHoney : .primary)
            if !model.advisoryText.isEmpty {
                Text(model.advisoryText)
                    .font(highContrast ? .system(.title3, weight: .semibold) : .subheadline)
                    .foregroundStyle(highContrast ? .white : Color.beeWarn)
            }
        }
        .padding(highContrast ? 20 : 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(highContrast ? AnyShapeStyle(Color.black.opacity(0.92)) : AnyShapeStyle(.ultraThinMaterial),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(model.advisoryText.isEmpty ? model.proximityText : "\(model.proximityText)。\(model.advisoryText)")
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("点按重复播报")
        .contentShape(Rectangle())
        .onTapGesture { model.repeatLastAnnouncement() }
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
            // 求助不依赖相机：即使相机被拒，仍让用户能呼叫志愿者/亲友。
            Button("呼叫帮手") { showRemoteAssist = true }
                .buttonStyle(.bordered)
                .controlSize(.large)
        }
        .padding()
        // 相机变为不可用是安全攸关的状态变化——主动朗读，避免盲人误以为避障仍在工作（见无障碍审计）。
        .onAppear { A11y.announce("相机权限被关闭，避障已停止。请到设置开启相机权限，或呼叫帮手。") }
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
            // 设备不支持避障（无 LiDAR），但远程求助不依赖 LiDAR/相机，仍提供入口（见复审 #5）。
            helpFallbackButton
        }
        .padding()
        .onAppear { A11y.announce("设备不支持避障。\(message)") } // 安全攸关，主动朗读（见无障碍审计）
    }

    private func messageView(_ text: String) -> some View {
        Text(text)
            .font(.headline)
            .multilineTextAlignment(.center)
            .padding()
    }

    /// 带可选求助按钮的状态提示（相机出错等）。
    private func stateMessageView(_ text: String, showHelp: Bool) -> some View {
        VStack(spacing: 16) {
            Text(text).font(.headline).multilineTextAlignment(.center)
            if showHelp { helpFallbackButton }
        }
        .padding()
        .onAppear { A11y.announce(text) } // 相机出错主动朗读（见无障碍审计）
    }
}

/// 可选 VoiceOver 提示修饰符（hint 为空则不加）。
private struct OptionalA11yHint: ViewModifier {
    let hint: String?
    func body(content: Content) -> some View {
        if let hint { content.accessibilityHint(hint) } else { content }
    }
}

#Preview {
    HomeView()
}
