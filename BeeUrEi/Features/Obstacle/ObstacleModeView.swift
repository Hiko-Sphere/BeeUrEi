import SwiftUI

/// 实时避障模式（独立全屏）：从原首屏抽出的相机/ARKit 避障界面。
/// 现在**只在用户显式进入**时才创建并启动 AR 会话（首屏 Hub 不再自动开相机）。
/// 走路时所需的最小控制：退出、重复播报、我在哪、求助；双指双击=求助。
/// 安全行为与原首屏一致（移动而非重写）：相机权限/不支持/出错分支、屏幕常亮、求助界面期间暂停会话。
struct ObstacleModeView: View {
    let onClose: () -> Void

    @State private var model = HomeViewModel()
    @State private var showRemoteAssist = false
    @State private var locationDescriber = LocationDescriber()
    @State private var incoming = IncomingCallCenter.shared
    @Environment(AuthSession.self) private var session
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var schemeContrast

    private var wantsSolidSurfaces: Bool { reduceTransparency || schemeContrast == .increased }
    private var lang: Language { FeatureSettings().language }
    private var helpEnabled: Bool { session.features.calls || session.features.helpRequests }

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
                if case .running = model.state { controlBar }
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
        .sheet(isPresented: $showRemoteAssist) {
            RemoteAssistView { showRemoteAssist = false }
        }
        // 求助界面也用相机：呈现时暂停避障会话（求助页自持常亮 assist）；关闭返回时恢复并重置常亮计时器
        // （与设置的「常亮时长」一致：每次回到避障都重新计时，避免刚回来就息屏）。
        .onChange(of: showRemoteAssist) { _, shown in
            if shown { model.pauseSession() }
            else { model.resumeSession(); ScreenWake.acquire("obstacle", seconds: FeatureSettings().keepAwakeSeconds) }
        }
        // 来电到达：同步暂停避障会话——立刻释放相机与音频总线，赶在全屏被收起前让根层来电界面接管，
        // 避免与 CallView 争抢相机致 ARKit 失败；pauseSession 先置 paused=true，也压掉「测距暂停」的多余播报。
        .onChange(of: incoming.hasIncoming) { _, inCall in if inCall { model.pauseSession() } }
        // 双指双击 = 一键求助（盲人最紧急动作不需找按钮）。
        .accessibilityAction(.magicTap) { requestRemoteHelp() }
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
