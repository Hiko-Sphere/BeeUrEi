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
    @State private var weatherSpeaker = WeatherSpeaker()
    @State private var motionMonitor = MotionMonitor()          // 摔倒/撞击监测（设置可关）
    @State private var emergency = EmergencyAlertCenter.shared
    @State private var voice = VoiceCommandListener()           // 语音指令（麦克风键）
    @State private var showMessages = false                     // 聊天（绑定亲友互发）
    @State private var unreadTotal = 0
    @State private var unreadPollTask: Task<Void, Never>?
    @Environment(AuthSession.self) private var session
    @State private var idleTask: Task<Void, Never>? // 屏幕常亮计时（到时允许系统息屏）
    @State private var incoming = IncomingCallCenter.shared // 监听来电（接听别人的呼叫经此在根层呈现）
    @State private var route = AppRoute.shared              // Siri/快捷指令路由（一句话直达）
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency // 减弱透明度→实底
    @Environment(\.colorSchemeContrast) private var schemeContrast               // 增强对比→实底+更高对比
    private let consentStore = ConsentStore()

    /// 系统开了「降低透明度」或「增强对比度」时，相机画面上的浮层一律用实底（材质会透出画面致对比不足）。
    private var wantsSolidSurfaces: Bool { reduceTransparency || schemeContrast == .increased }

    var body: some View {
        ZStack {
            content
            // 红绿灯第三通道（Oko 式，低视力/盲聋可视）：全屏高对比色框 + 顶部大字状态。
            // 与节奏音频/节奏震动并行；语音由协调器另行播报，此处对 VoiceOver 隐藏。
            if case .running = model.state, model.trafficLight != .unknown {
                crossingOverlay(model.trafficLight)
            }
            if DevSettings().enabled, case .running = model.state {
                DevROIOverlay(roi: model.currentROI)
                    .ignoresSafeArea()
            }
            VStack(spacing: BeeSpacing.md) {
                HStack(alignment: .top, spacing: BeeSpacing.sm) {
                    if case .running = model.state { statusBanner } else { Spacer() }
                    micButton      // 语音指令（"我在哪/带我去X/给妈妈发消息说…"）
                    messagesButton // 聊天（未读角标）
                    settingsButton
                }
                if DevSettings().enabled { DevOverlayView(model: model) }
                Spacer()
                // 仅相机运行时显示底部操作面板：否则会与「相机权限被关闭/设备不支持」等居中提示重叠，
                // 且会把依赖相机的「看一看」等暴露为可点（见审查 #5）。求助按钮在权限页另行提供。
                if case .running = model.state { actionPanel }
            }
            .padding()
            // 摔倒/撞击警报卡：盖在一切之上（安全攸关）。
            if emergency.phase != .idle { emergencyOverlay }
        }
        .task {
            model.onAppear()
            applyKeepAwake()
            if !TutorialStore().seen { showTutorial = true }
            // 摔倒/撞击监测：主页存续期间持续运行（含进入识别/导航/通话后台时段，手机在身上）。
            if FeatureSettings().fallDetectionEnabled {
                motionMonitor.start { event in EmergencyAlertCenter.shared.trigger(event) }
            }
            // 未读消息角标 + 新消息总数变化（详情播报在聊天页内进行）。
            unreadPollTask = Task {
                while !Task.isCancelled {
                    if let token = session.token,
                       let convs = try? await APIClient().conversations(token: token) {
                        unreadTotal = convs.reduce(0) { $0 + $1.unread }
                    }
                    try? await Task.sleep(for: .seconds(15))
                }
            }
        }
        .onDisappear { model.onDisappear(); releaseKeepAwake(); motionMonitor.stop(); unreadPollTask?.cancel() }
        .sheet(isPresented: $showMessages) { ConversationsView(session: session) }
        .fullScreenCover(isPresented: $showTutorial) {
            TutorialView { TutorialStore().seen = true; showTutorial = false }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView(store: consentStore) { showSettings = false }
        }
        .onChange(of: showSettings) { _, shown in if !shown { applyKeepAwake() } } // 设置可能改了常亮时长，返回时重新应用
        // Siri/快捷指令直达（来电优先级更高：来电中忽略路由请求）。
        .onChange(of: route.pending) { _, dest in
            guard let dest, !incoming.hasIncoming else { route.pending = nil; return }
            route.pending = nil
            switch dest {
            case .help: showRemoteAssist = true
            case .lookAround: showFraming = true
            case .whereAmI: locationDescriber.describe()
            }
        }
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
        // 首启教程呈现时也暂停避障（语音冲突审计：否则教程朗读与避障播报同时出声）。
        .onChange(of: showTutorial) { _, shown in
            if shown { model.pauseSession() } else { model.resumeSession() }
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
        // 主屏 Magic Tap（双指双击）= 一键求助：盲人最紧急的动作不需要找按钮（系统惯例：Magic Tap=最重要操作）。
        .accessibilityAction(.magicTap) {
            guard !incoming.hasIncoming else { return }
            showRemoteAssist = true
        }
    }

    // MARK: 摔倒/撞击警报卡（全屏、超大按钮、自动朗读）

    private var emergencyOverlay: some View {
        ZStack {
            Color.black.opacity(0.86).ignoresSafeArea()
            VStack(spacing: BeeSpacing.lg) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 56)).foregroundStyle(Color.beeWarn)
                Text(HomeStrings.fallAlertTitle(lang)).font(.title.bold()).foregroundStyle(.white)
                switch emergency.phase {
                case .countdown(_, let seconds):
                    Text("\(seconds)").font(.system(size: 64, weight: .heavy)).foregroundStyle(Color.beeHoney)
                        .accessibilityHidden(true) // 数字跳动不打扰 VO；语音提醒已按节点播报
                    BeeBigButton(HomeStrings.imOK(lang), systemImage: "checkmark.circle.fill", tint: .beeSuccess, foreground: .white) {
                        emergency.cancel()
                    }
                    BeeBigButton(HomeStrings.notifyNow(lang), systemImage: "bell.badge.fill", tint: .beeDanger, foreground: .white) {
                        emergency.sendNow()
                    }
                case .sending:
                    ProgressView().tint(.white).scaleEffect(1.6)
                case .sent(let n):
                    Text(HomeStrings.fallAlertSent(n, lang)).font(.title3).foregroundStyle(.white)
                        .multilineTextAlignment(.center).padding(.horizontal)
                case .failed:
                    Text(HomeStrings.fallAlertFailed(lang)).font(.title3).foregroundStyle(.white)
                        .multilineTextAlignment(.center).padding(.horizontal)
                    BeeBigButton(HomeStrings.helpTitle(lang), systemImage: "hand.raised.fill", tint: .beeHoney) {
                        showRemoteAssist = true
                    }
                case .idle:
                    EmptyView()
                }
            }
            .padding()
        }
        // 警报期间 Magic Tap = 我没事（最快的取消通道）。
        .accessibilityAction(.magicTap) { emergency.cancel() }
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
            // 全屏高对比边框：低视力用户用余光即可感知状态。
            RoundedRectangle(cornerRadius: 0)
                .strokeBorder(color, lineWidth: 14)
                .ignoresSafeArea()
            Text(text)
                .font(.title2.bold()).foregroundStyle(.white)
                .padding(.horizontal, 20).padding(.vertical, 10)
                .background(color, in: Capsule())
                .padding(.top, 60)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true) // 语音由反馈协调器播报；色块仅服务低视力/盲聋用户
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

    /// 主屏文案语言（E5）：每次渲染解析，与各屏同一真相来源。
    private var lang: Language { FeatureSettings().language }

    private var actionPanel: some View {
        VStack(spacing: BeeSpacing.sm) {
            // 首要操作：求助（最大、蜂蜜黄；全屏任意处 Magic Tap 也直达）。
            BeeBigButton(HomeStrings.helpTitle(lang), systemImage: "hand.raised.fill",
                         subtitle: HomeStrings.helpSubtitle(lang), tint: .beeHoney) {
                showRemoteAssist = true
            }
            .accessibilityHint(HomeStrings.magicTapHint(lang))
            // 两大功能屏：识别 / 导航。
            HStack(spacing: BeeSpacing.sm) {
                tile(HomeStrings.tileLook(lang), systemImage: "viewfinder",
                     hint: HomeStrings.hintLook(lang)) { showFraming = true }
                tile(HomeStrings.tileNav(lang), systemImage: "figure.walk") { showNavigation = true }
            }
            // 环境感知四键（同类动作编为一组：VoiceOver 报"环境感知"分组名，可预期、可记忆）。
            VStack(spacing: BeeSpacing.sm) {
                HStack(spacing: BeeSpacing.sm) {
                    tile(HomeStrings.tileWhereAmI(lang), systemImage: "location.fill",
                         hint: HomeStrings.hintWhereAmI(lang)) { locationDescriber.describe() }
                    tile(HomeStrings.tileAround(lang), systemImage: "dot.circle.viewfinder",
                         hint: HomeStrings.hintAround(lang)) { locationDescriber.describeAround() }
                }
                HStack(spacing: BeeSpacing.sm) {
                    tile(HomeStrings.tileAhead(lang), systemImage: "arrow.up.circle",
                         hint: HomeStrings.hintAhead(lang)) { locationDescriber.describeAhead() }
                    // 设置入口固定在右上角齿轮（位置可记忆），磁贴位让给高频的「天气」。
                    tile(HomeStrings.tileWeather(lang), systemImage: "cloud.sun.fill",
                         hint: HomeStrings.hintWeather(lang)) { weatherSpeaker.announce() }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(HomeStrings.envGroup(lang))
        }
    }

    /// 方块磁贴按钮：深底白字 + 蜂蜜黄图标，保证在任意相机画面上都清晰可读；超大点按区。
    /// 「降低透明度/增强对比」时实底化（材质/半透明会透出相机画面致对比不足）。
    private func tile(_ title: String, systemImage: String, hint: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: BeeSpacing.sm) {
                Image(systemName: systemImage).font(.system(size: 32, weight: .bold)).foregroundStyle(Color.beeHoney)
                Text(title).font(.title3.weight(.semibold)).foregroundStyle(.white)
                    .minimumScaleFactor(0.7).lineLimit(1) // 大字优先；超长（英文）按比例回缩不截断
            }
            .frame(maxWidth: .infinity, minHeight: 100)
            .background(Color.beeInk.opacity(wantsSolidSurfaces ? 1 : 0.88),
                        in: RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous)
                .strokeBorder(.white.opacity(0.10), lineWidth: 0.5))
            .contentShape(RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous))
        }
        .buttonStyle(BeePressStyle())
        .accessibilityLabel(title)
        .modifier(OptionalA11yHint(hint: hint))
    }

    private var settingsButton: some View {
        Button { showSettings = true } label: {
            Image(systemName: "gearshape.fill")
                .font(.title2)
                .padding(12)
                .background(wantsSolidSurfaces ? AnyShapeStyle(Color.beeInk) : AnyShapeStyle(.ultraThinMaterial), in: Circle())
                .foregroundStyle(wantsSolidSurfaces ? .white : Color.primary)
        }
        .buttonStyle(BeePressStyle())
        .accessibilityLabel(HomeStrings.tileSettings(lang))
    }

    /// 语音指令麦克风（固定右上区）：点击说话，再点或停顿 1.5s 自动执行。
    private var micButton: some View {
        Button {
            voice.toggle { command, transcript in handleVoiceCommand(command, transcript: transcript) }
        } label: {
            Image(systemName: voice.isListening ? "waveform.circle.fill" : "mic.fill")
                .font(.title2)
                .padding(12)
                .background(voice.isListening ? AnyShapeStyle(Color.beeDanger)
                            : (wantsSolidSurfaces ? AnyShapeStyle(Color.beeInk) : AnyShapeStyle(.ultraThinMaterial)),
                            in: Circle())
                .foregroundStyle(voice.isListening || wantsSolidSurfaces ? .white : Color.primary)
        }
        .buttonStyle(BeePressStyle())
        .accessibilityLabel(HomeStrings.voiceButton(lang))
        .accessibilityHint(HomeStrings.voiceButtonHint(lang))
    }

    /// 消息入口（未读角标）。
    private var messagesButton: some View {
        Button { showMessages = true } label: {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.title2)
                .padding(12)
                .background(wantsSolidSurfaces ? AnyShapeStyle(Color.beeInk) : AnyShapeStyle(.ultraThinMaterial), in: Circle())
                .foregroundStyle(wantsSolidSurfaces ? .white : Color.primary)
                .overlay(alignment: .topTrailing) {
                    if unreadTotal > 0 {
                        Text("\(min(unreadTotal, 99))")
                            .font(.caption2.bold()).foregroundStyle(.white)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color.beeDanger, in: Capsule())
                            .accessibilityHidden(true)
                    }
                }
        }
        .buttonStyle(BeePressStyle())
        .accessibilityLabel(ChatStrings.messagesButton(lang)
                            + (unreadTotal > 0 ? "，" + ChatStrings.unreadBadgeA11y(unreadTotal, lang) : ""))
    }

    /// 语音指令路由：解析结果 → 对应功能（确认/失败播报全部走总线，不与避障/导航重叠）。
    private func handleVoiceCommand(_ command: VoiceCommand, transcript: String) {
        func speak(_ text: String) { SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode) }
        switch command {
        case .help: showRemoteAssist = true
        case .whereAmI: locationDescriber.describe()
        case .around: locationDescriber.describeAround()
        case .ahead: locationDescriber.describeAhead()
        case .weather: weatherSpeaker.announce()
        case .look: showFraming = true
        case .readText: route.pendingChannel = .text; showFraming = true
        case .banknote: route.pendingChannel = .banknote; showFraming = true
        case .scanCode: route.pendingChannel = .scan; showFraming = true
        case .navigate(let dest):
            if let dest { AppRoute.shared.pendingNavAction = .search(dest) }
            showNavigation = true
        case .goHome:
            AppRoute.shared.pendingNavAction = .backtrack
            showNavigation = true
        case .messages: showMessages = true
        case .sendMessage(let to, let text): sendVoiceMessage(to: to, text: text)
        case .repeatLast: model.repeatLastAnnouncement()
        case .unknown:
            speak(transcript.isEmpty ? HomeStrings.voiceHeardNothing(lang)
                                     : HomeStrings.voiceNotUnderstood(lang))
        }
    }

    /// "给X发消息说Y"：按绑定亲友昵称匹配收件人，命中唯一即直接发送并播报结果。
    private func sendVoiceMessage(to name: String, text: String) {
        func speak(_ t: String) { SpeechHub.shared.speak(t, channel: .query, voiceCode: lang.voiceCode) }
        guard let token = session.token else { speak(HomeStrings.voiceNeedLogin(lang)); return }
        Task {
            let links = (try? await APIClient().familyLinks(token: token)) ?? []
            let accepted = links.filter { $0.isAccepted }
            let matches = accepted.filter { $0.memberName.localizedCaseInsensitiveContains(name) }
            guard matches.count == 1, let target = matches.first else {
                speak(HomeStrings.voiceNoContact(name, lang))
                showMessages = true // 打开消息列表让用户自己选
                return
            }
            if (try? await APIClient().sendMessage(token: token, toId: target.memberId, kind: "text", text: text)) != nil {
                speak(HomeStrings.voiceSent(target.memberName, lang))
            } else {
                speak(ChatStrings.sendFailed(lang))
            }
        }
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
            stateMessageView(HomeStrings.cameraError(message, lang), showHelp: true)
        case .idle:
            messageView(HomeStrings.starting(lang))
        }
    }

    /// 求助入口兜底：相机不可用（设备不支持/出错）时，求助不依赖相机，仍让视障用户能呼叫。
    private var helpFallbackButton: some View {
        Button(HomeStrings.callHelper(lang)) { showRemoteAssist = true }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
    }

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
        // 高对比模式恒为实底；普通模式下若系统开了降低透明度/增强对比也实底化（材质透出相机画面致对比不足）。
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

    private var permissionDeniedView: some View {
        VStack(spacing: 16) {
            Text(HomeStrings.permTitle(lang))
                .font(.title2).bold()
            Text(HomeStrings.permBody(lang))
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            Button(HomeStrings.openSettings(lang)) { model.openSettings() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            // 求助不依赖相机：即使相机被拒，仍让用户能呼叫志愿者/亲友。
            Button(HomeStrings.callHelper(lang)) { showRemoteAssist = true }
                .buttonStyle(.bordered)
                .controlSize(.large)
        }
        .padding()
        // 相机变为不可用是安全攸关的状态变化——主动朗读，避免盲人误以为避障仍在工作（见无障碍审计）。
        .onAppear { A11y.announce(HomeStrings.permAnnounce(lang)) }
    }

    private func unsupportedView(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "iphone.gen3.slash")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text(HomeStrings.unsupportedTitle(lang))
                .font(.title2).bold()
            Text(message)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            // 设备不支持避障（无 LiDAR），但远程求助不依赖 LiDAR/相机，仍提供入口（见复审 #5）。
            helpFallbackButton
        }
        .padding()
        .onAppear { A11y.announce(HomeStrings.unsupportedAnnounce(message, lang)) } // 安全攸关，主动朗读（见无障碍审计）
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
