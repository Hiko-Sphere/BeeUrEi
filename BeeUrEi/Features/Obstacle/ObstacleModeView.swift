import SwiftUI
import UIKit

/// 实时避障模式（独立全屏）：从原首屏抽出的相机/ARKit 避障界面。
/// 现在**只在用户显式进入**时才创建并启动 AR 会话（首屏 Hub 不再自动开相机）。
/// 走路时所需的最小控制：退出、重复播报、我在哪、求助；双指双击=求助。
/// 安全行为与原首屏一致（移动而非重写）：相机权限/不支持/出错分支、屏幕常亮、求助界面期间暂停会话。
struct ObstacleModeView: View {
    let onClose: () -> Void

    @State private var model = HomeViewModel()
    @State private var showRemoteAssist = false
    @State private var locationDescriber = LocationDescriber()
    @State private var weatherSpeaker = WeatherSpeaker()
    @State private var incoming = IncomingCallCenter.shared
    // 快捷操作（与主页一致）：避障中也能直达看一看/导航/天气/环境/消息/位置/设置，无需先退出避障。
    @State private var showQuickActions = false
    @State private var pendingQuick: ObstacleQuickAction?   // 选定动作后先收菜单、再在 onDismiss 呈现，避免同帧切两个模态
    @State private var showFraming = false
    @State private var showNavigation = false
    @State private var showMessages = false
    @State private var showLocation = false
    @State private var showSettings = false
    private let consentStore = ConsentStore()
    @Environment(AuthSession.self) private var session
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var schemeContrast

    private var wantsSolidSurfaces: Bool { reduceTransparency || schemeContrast == .increased }
    private var lang: Language { FeatureSettings().language }
    private var helpEnabled: Bool { session.features.calls || session.features.helpRequests }

    /// 任一相机/全屏的次级界面呈现中（含快捷操作菜单与其待呈现动作）：用于暂停避障会话、避免争抢相机/越界播报。
    /// 把 pendingQuick 计入，避免「收菜单→开下一屏」过渡瞬间误判为空、来回 pause/resume 抖动。
    private var anySecondaryShown: Bool {
        showRemoteAssist || showQuickActions || showFraming || showNavigation
            || showMessages || showLocation || showSettings || pendingQuick != nil
    }

    var body: some View {
        ZStack {
            content
            if case .running = model.state, model.trafficLight != .unknown {
                crossingOverlay(model.trafficLight)
            }
            if DevSettings().enabled, case .running = model.state {
                DevROIOverlay(roi: model.currentROI).ignoresSafeArea()
            }
            VStack(spacing: BeeSpacing.md) {
                topBar
                if DevSettings().enabled { DevOverlayView(model: model) }
                Spacer()
                if case .running = model.state {
                    VStack(spacing: BeeSpacing.sm) {
                        controlBar
                        moreButton
                    }
                }
            }
            .padding()
        }
        .task {
            model.onAppear()
            // 走路时屏不能灭；引用计数，来电/求助各自独立持有。
            // 尊重「避障屏幕常亮时长」设置：0=永久（默认，避障安全攸关），>0=常亮该秒数后交还系统息屏省电。
            ScreenWake.acquire("obstacle", seconds: FeatureSettings().keepAwakeSeconds)
            // 进入确认（让盲人知道已切到避障；与避障播报经语音总线协调，不会重叠）。
            SpeechHub.shared.speak(HomeStrings.guideStartedSpeak(lang), channel: .query, voiceCode: lang.voiceCode)
        }
        .onDisappear { model.onDisappear(); ScreenWake.release("obstacle") }
        // 求助 / 快捷操作里需相机或全屏的次级界面：与原首屏一致经各自 onClose 关闭。
        .sheet(isPresented: $showRemoteAssist) { RemoteAssistView { showRemoteAssist = false } }
        .sheet(isPresented: $showQuickActions, onDismiss: runPendingQuick) {
            ObstacleQuickActionsView(lang: lang, items: quickActionItems) { action in
                pendingQuick = action; showQuickActions = false   // 先收菜单，待 onDismiss 再呈现/播报
            }
        }
        .fullScreenCover(isPresented: $showFraming) { FramingAssistView { showFraming = false } }
        .sheet(isPresented: $showNavigation) { WalkNavigationView { showNavigation = false } }
        .sheet(isPresented: $showMessages) { ConversationsView(session: session) }
        .sheet(isPresented: $showLocation) { NavigationStack { LiveLocationView(isBlind: true) } }
        .sheet(isPresented: $showSettings) { SettingsView(store: consentStore) { showSettings = false } }
        // 任一次级界面（求助/取景/导航/消息/位置/设置/快捷菜单）呈现时暂停避障会话——释放相机与音频总线、
        // 不越界播报；全部关闭回到避障时恢复并重置常亮计时器（与「常亮时长」设置一致，避免刚回来就息屏）。
        .onChange(of: anySecondaryShown) { _, shown in
            if shown { model.pauseSession() }
            else { model.resumeSession(); ScreenWake.acquire("obstacle", seconds: FeatureSettings().keepAwakeSeconds) }
        }
        // 来电到达：同步暂停避障会话——立刻释放相机与音频总线，赶在全屏被收起前让根层来电界面接管，
        // 避免与 CallView 争抢相机致 ARKit 失败；pauseSession 先置 paused=true，也压掉「测距暂停」的多余播报。
        .onChange(of: incoming.hasIncoming) { _, inCall in if inCall { model.pauseSession() } }
        // 双指双击 = 一键求助（盲人最紧急动作不需找按钮）。
        .accessibilityAction(.magicTap) { requestRemoteHelp() }
    }

    // MARK: 更多快捷操作（与主页一致的动作集，避障中直达）

    private var moreButton: some View {
        Button { showQuickActions = true } label: {
            HStack(spacing: 8) {
                Image(systemName: "square.grid.2x2.fill").font(.headline)
                Text(HomeStrings.quickActionsTitle(lang)).font(.headline)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(Color.beeInk.opacity(wantsSolidSurfaces ? 1 : 0.88),
                        in: RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous)
                .strokeBorder(.white.opacity(0.10), lineWidth: 0.5))
            .contentShape(RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous))
        }
        .buttonStyle(BeePressStyle())
        .accessibilityLabel(HomeStrings.quickActionsTitle(lang))
        .accessibilityHint(HomeStrings.quickActionsHint(lang))
    }

    /// 快捷操作清单（与主页 HubView 一致）：标题/图标/禁用原因都在此按功能开关算好，交给菜单渲染。
    /// 避障中已常驻「重复 / 我在哪 / 求助」在控制条，菜单收纳其余动作。
    private var quickActionItems: [ObstacleQuickActionItem] {
        func reason(_ on: Bool) -> String? { on ? nil : HomeStrings.featureOff(lang) }
        return [
            .init(action: .look, title: HomeStrings.tileLook(lang), systemImage: "viewfinder",
                  disabledReason: reason(session.features.sceneScan)),
            .init(action: .navigate, title: HomeStrings.tileNav(lang), systemImage: "signpost.right.fill",
                  disabledReason: reason(session.features.navigation)),
            .init(action: .weather, title: HomeStrings.tileWeather(lang), systemImage: "cloud.sun.fill",
                  disabledReason: nil),
            .init(action: .around, title: HomeStrings.tileAround(lang), systemImage: "dot.circle.viewfinder",
                  disabledReason: nil),
            .init(action: .ahead, title: HomeStrings.tileAhead(lang), systemImage: "arrow.up.circle",
                  disabledReason: nil),
            .init(action: .messages, title: ChatStrings.navTitle(lang), systemImage: "bubble.left.and.bubble.right.fill",
                  disabledReason: reason(session.features.messaging)),
            .init(action: .location, title: HomeStrings.tileLocShare(lang), systemImage: "location.fill.viewfinder",
                  disabledReason: reason(session.features.locationSharing)),
            .init(action: .settings, title: HomeStrings.tileSettings(lang), systemImage: "gearshape.fill",
                  disabledReason: nil),
        ]
    }

    /// 菜单关闭后执行选定动作：纯播报类立即开口；需相机/全屏的设 show* 由对应 sheet/cover 呈现。
    private func runPendingQuick() {
        guard let a = pendingQuick else { return }
        pendingQuick = nil
        switch a {
        case .look: showFraming = true
        case .navigate: showNavigation = true
        case .weather: weatherSpeaker.announce()
        case .around: locationDescriber.describeAround()
        case .ahead: locationDescriber.describeAhead()
        case .messages: showMessages = true
        case .location: showLocation = true
        case .settings: showSettings = true
        }
    }

    // MARK: 顶部栏（退出 + 状态条）

    private var topBar: some View {
        HStack(alignment: .top, spacing: BeeSpacing.sm) {
            Button(action: onClose) {
                HStack(spacing: 6) {
                    Image(systemName: "xmark")
                    Text(HomeStrings.exitGuide(lang)).font(.subheadline.weight(.semibold))
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(wantsSolidSurfaces ? AnyShapeStyle(Color.beeInk) : AnyShapeStyle(.ultraThinMaterial), in: Capsule())
                .foregroundStyle(wantsSolidSurfaces ? .white : Color.primary)
            }
            .buttonStyle(BeePressStyle())
            .accessibilityLabel(HomeStrings.exitGuide(lang))
            if case .running = model.state { statusBanner } else { Spacer() }
        }
    }

    // MARK: 底部控制条（重复 / 我在哪 / 求助）

    private var controlBar: some View {
        HStack(spacing: BeeSpacing.sm) {
            controlTile(HomeStrings.repeatLabel(lang), systemImage: "arrow.clockwise.circle") {
                model.repeatLastAnnouncement()
            }
            controlTile(HomeStrings.tileWhereAmI(lang), systemImage: "location.fill") {
                locationDescriber.describe()
            }
            controlTile(HomeStrings.helpTitle(lang), systemImage: "hand.raised.fill", prominent: true) {
                requestRemoteHelp()
            }
            .opacity(helpEnabled ? 1 : 0.5)
            .disabled(!helpEnabled)
        }
    }

    private func controlTile(_ title: String, systemImage: String, prominent: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: systemImage).font(.system(size: 28, weight: .bold))
                    .foregroundStyle(prominent ? Color.beeInk : Color.beeHoney)
                Text(title).font(.headline).foregroundStyle(prominent ? Color.beeInk : .white)
                    .minimumScaleFactor(0.7).lineLimit(1)
            }
            .frame(maxWidth: .infinity, minHeight: 92)
            .background(prominent ? AnyShapeStyle(Color.beeHoney)
                        : AnyShapeStyle(Color.beeInk.opacity(wantsSolidSurfaces ? 1 : 0.88)),
                        in: RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous)
                .strokeBorder(.white.opacity(0.10), lineWidth: 0.5))
            .contentShape(RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous))
        }
        .buttonStyle(BeePressStyle())
        .accessibilityLabel(title)
    }

    private func requestRemoteHelp() {
        if helpEnabled { showRemoteAssist = true }
        else { SpeechHub.shared.speak(HomeStrings.featureOff(lang), channel: .query, voiceCode: lang.voiceCode) }
    }

    private var helpFallbackButton: some View {
        BeeBigButton(HomeStrings.callHelper(lang), systemImage: "hand.raised.fill", tint: .beeHoney) {
            requestRemoteHelp()
        }
        .padding(.horizontal)
    }

    // MARK: 状态条（与原首屏一致）

    private var statusBanner: some View {
        let highContrast = FeatureSettings().highContrast
        return VStack(alignment: .leading, spacing: 6) {
            Text(model.proximityText)
                .font(highContrast ? .system(.title, weight: .bold) : .system(.title2, weight: .bold))
                .foregroundStyle(highContrast ? Color.beeHoney : (wantsSolidSurfaces ? .white : .primary))
            if !model.advisoryText.isEmpty {
                Text(model.advisoryText)
                    .font(highContrast ? .system(.title3, weight: .semibold) : .subheadline)
                    .foregroundStyle(highContrast || wantsSolidSurfaces ? .white : Color.beeWarn)
            }
        }
        .padding(highContrast ? 20 : 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(highContrast || wantsSolidSurfaces
                        ? AnyShapeStyle(Color.black.opacity(highContrast ? 0.92 : 0.85))
                        : AnyShapeStyle(.regularMaterial),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(model.advisoryText.isEmpty ? model.proximityText : "\(model.proximityText)。\(model.advisoryText)")
        .accessibilityAddTraits([.isButton, .updatesFrequently])
        .accessibilityHint(HomeStrings.tapToRepeat(lang))
        .contentShape(Rectangle())
        .onTapGesture { model.repeatLastAnnouncement() }
    }

    // MARK: 红绿灯全屏色块（Oko 式第三通道）

    private func crossingOverlay(_ state: TrafficLightState) -> some View {
        let (color, text): (Color, String) = {
            switch state {
            case .red: return (.beeDanger, HomeStrings.trafficRed(lang))
            case .green: return (.beeSuccess, HomeStrings.trafficGreen(lang))
            case .yellow: return (.beeWarn, HomeStrings.trafficYellow(lang))
            case .unknown: return (.clear, "")
            }
        }()
        return ZStack(alignment: .top) {
            RoundedRectangle(cornerRadius: 0).strokeBorder(color, lineWidth: 14).ignoresSafeArea()
            Text(text).font(.title2.bold()).foregroundStyle(.white)
                .padding(.horizontal, 20).padding(.vertical, 10)
                .background(color, in: Capsule()).padding(.top, 60)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    // MARK: 相机状态分支（与原首屏一致）

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .running:
            ARSessionPreviewView(session: model.arSession)
                .ignoresSafeArea()
                .accessibilityHidden(true)
        case .denied:
            permissionDeniedView
        case .unsupported(let message):
            unsupportedView(message)
        case .failed(let message):
            stateMessageView(HomeStrings.cameraError(message, lang), showHelp: true)
        case .idle:
            Text(HomeStrings.starting(lang)).font(.headline).multilineTextAlignment(.center).padding()
        }
    }

    private var permissionDeniedView: some View {
        VStack(spacing: 16) {
            Text(HomeStrings.permTitle(lang)).font(.title2).bold()
            Text(HomeStrings.permBody(lang)).multilineTextAlignment(.center).padding(.horizontal)
            BeeBigButton(HomeStrings.openSettings(lang), systemImage: "gearshape.fill", tint: .beeHoney) { model.openSettings() }
                .padding(.horizontal)
            BeeBigButton(HomeStrings.callHelper(lang), systemImage: "hand.raised.fill", tint: .beeInk, foreground: .white) { requestRemoteHelp() }
                .padding(.horizontal)
        }
        .padding()
        .onAppear { SpeechHub.shared.speak(HomeStrings.permAnnounce(lang), channel: .query, voiceCode: lang.voiceCode) }
    }

    private func unsupportedView(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "iphone.gen3.slash").font(.system(size: 48)).foregroundStyle(.secondary)
            Text(HomeStrings.unsupportedTitle(lang)).font(.title2).bold()
            Text(message).multilineTextAlignment(.center).padding(.horizontal)
            helpFallbackButton
        }
        .padding()
        .onAppear { SpeechHub.shared.speak(HomeStrings.unsupportedAnnounce(message, lang), channel: .query, voiceCode: lang.voiceCode) }
    }

    private func stateMessageView(_ text: String, showHelp: Bool) -> some View {
        VStack(spacing: 16) {
            Text(text).font(.headline).multilineTextAlignment(.center)
            BeeBigButton(HomeStrings.retry(lang), systemImage: "arrow.clockwise", tint: .beeHoney) { model.retrySession() }
                .padding(.horizontal)
            if showHelp { helpFallbackButton }
        }
        .padding()
        .onAppear { SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode) }
    }

}

/// 避障内「快捷操作」可选的动作（与主页 HubView 的动作集一致；求助/重复/我在哪已常驻控制条）。
enum ObstacleQuickAction { case look, navigate, weather, around, ahead, messages, location, settings }

/// 一个快捷操作磁贴的描述：标题/图标 + 可选「禁用原因」（功能关闭时朗读，不用 .disabled）。
struct ObstacleQuickActionItem: Identifiable {
    let action: ObstacleQuickAction
    let title: String
    let systemImage: String
    let disabledReason: String?
    var id: String { title }   // 菜单内标题唯一
}

/// 避障内的「快捷操作」菜单（与主页一致的动作集）：两列大磁贴、深底白字蜂蜜图标、VoiceOver 友好。
/// 功能关闭项变暗但仍可点、点按朗读原因（与主页磁贴一致，不用 `.disabled` 以免 VoiceOver 关时点了无反馈）。
private struct ObstacleQuickActionsView: View {
    let lang: Language
    let items: [ObstacleQuickActionItem]
    let onSelect: (ObstacleQuickAction) -> Void
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var schemeContrast
    private var wantsSolidSurfaces: Bool { reduceTransparency || schemeContrast == .increased }

    private let cols = [GridItem(.flexible(), spacing: BeeSpacing.sm), GridItem(.flexible(), spacing: BeeSpacing.sm)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: cols, spacing: BeeSpacing.sm) {
                    ForEach(items) { tile($0) }
                }
                .padding()
            }
            .background(Color.beeInk.ignoresSafeArea())
            .navigationTitle(HomeStrings.quickActionsTitle(lang))
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func tile(_ item: ObstacleQuickActionItem) -> some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            if let r = item.disabledReason {
                SpeechHub.shared.speak(r, channel: .query, voiceCode: lang.voiceCode)   // 关闭项：朗读原因，菜单保留
            } else {
                onSelect(item.action)
            }
        } label: {
            VStack(spacing: BeeSpacing.sm) {
                Image(systemName: item.systemImage).font(.system(size: 30, weight: .bold)).foregroundStyle(Color.beeHoney)
                Text(item.title).font(.headline).foregroundStyle(.white)
                    .minimumScaleFactor(0.7).lineLimit(2).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, minHeight: 100)
            .background(Color.beeInk.opacity(wantsSolidSurfaces ? 1 : 0.7),
                        in: RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous)
                .strokeBorder(.white.opacity(0.12), lineWidth: 0.5))
            .contentShape(RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous))
        }
        .buttonStyle(BeePressStyle())
        .opacity(item.disabledReason == nil ? 1 : 0.5)
        .accessibilityLabel(item.title)
        .accessibilityHint(item.disabledReason ?? "")
    }
}
