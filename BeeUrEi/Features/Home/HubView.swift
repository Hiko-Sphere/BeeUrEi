import SwiftUI
import UIKit

/// 视障首屏（全新 Hub）：**不再自动进入导盲/相机**。落地是一个平静的功能中枢——
/// 大字高对比、超大带标签按钮、VoiceOver 优先；求助最突出且双指双击随时直达；
/// 导盲/避障降级为「出行」区里一个显眼的入口，由用户显式进入（独立全屏 ObstacleModeView）。
/// 始终在线的安全网（摔倒检测、来电、紧急、Siri 直达、语音指令）保留在本页。
struct HubView: View {
    @Environment(AuthSession.self) private var session
    @State private var showObstacle = false
    @State private var showRemoteAssist = false
    @State private var showNavigation = false
    @State private var showFraming = false
    @State private var showMessages = false
    @State private var showSettings = false
    @State private var showLocation = false
    @State private var showFamily = false        // 亲友与紧急呼叫（从设置移到首屏主要功能）
    @State private var showRecordings = false     // 我的录音（从设置移到首屏主要功能）
    @State private var showTutorial = false
    @State private var locationDescriber = LocationDescriber()
    @State private var weatherSpeaker = WeatherSpeaker()
    @State private var motionMonitor = MotionMonitor()
    @State private var emergency = EmergencyAlertCenter.shared
    @State private var voice = VoiceCommandListener()
    @State private var incoming = IncomingCallCenter.shared
    @State private var route = AppRoute.shared
    @State private var unreadTotal = 0
    @State private var unreadPollTask: Task<Void, Never>?
    @State private var didSpeakGreeting = false
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var schemeContrast
    private let consentStore = ConsentStore()

    private var wantsSolidSurfaces: Bool { reduceTransparency || schemeContrast == .increased }
    private var lang: Language { FeatureSettings().language }
    private var helpEnabled: Bool { session.features.calls || session.features.helpRequests }
    private var hasLiDAR: Bool { DeviceSupport.hasLiDAR }

    var body: some View {
        ZStack {
            Color.beeInk.ignoresSafeArea() // 实底深色：无相机、无材质，让深底磁贴达到设计对比
            hubContent
            if emergency.phase != .idle { emergencyOverlay } // 摔倒/撞击警报：盖在一切之上（安全攸关）
        }
        .task { await onAppear() }
        .onDisappear { motionMonitor.stop(); unreadPollTask?.cancel(); ScreenWake.release("emergency") }
        // 始终在线的安全网与路由（与原首屏一致）：
        .onChange(of: showSettings) { _, shown in if !shown { reconcileFallDetection() } }
        .onChange(of: voice.phase) { _, phase in
            if phase == .denied { SpeechHub.shared.speak(HomeStrings.voiceMicDenied(lang), channel: .query, voiceCode: lang.voiceCode) }
        }
        // 摔倒/撞击警报是安全攸关、必须盖在最上层：触发即收起一切模态（含导盲全屏），让全屏警报卡可见可操作；
        // 警报卡呈现期间保持常亮，让用户看清并能点「我没事/立即通知」（倒计时结束也会自动发送）。
        .onChange(of: emergency.phase) { _, phase in
            if phase != .idle { collapseAll(); ScreenWake.acquire("emergency") } else { ScreenWake.release("emergency") }
        }
        // 接到别人来电：收起一切模态（含导盲全屏，释放相机）让根层来电界面弹出。
        // 来电/接听界面各自持有常亮（IncomingCallView/CallView），故此处不再管常亮，避免收起导盲时误息屏。
        .onChange(of: incoming.hasIncoming) { _, inCall in if inCall { collapseAll() } }
        // Siri/快捷指令直达（来电优先；来电中忽略路由）。
        .onChange(of: route.pending) { _, dest in
            guard let dest, !incoming.hasIncoming else { route.pending = nil; return }
            route.pending = nil
            switch dest {
            case .help: requestRemoteHelp()
            case .lookAround: showFraming = true
            case .whereAmI: locationDescriber.describe()
            case .obstacle: enterObstacle()
            case .sos: emergency.manualSOS() // Siri 锁屏路径：倒计时+可取消覆盖层由既有链路呈现
            }
        }
        // 双指双击 = 一键求助。
        .accessibilityAction(.magicTap) { guard !incoming.hasIncoming else { return }; requestRemoteHelp() }
        // 呈现层
        .fullScreenCover(isPresented: $showObstacle) { ObstacleModeView { showObstacle = false } }
        .fullScreenCover(isPresented: $showFraming) { FramingAssistView { showFraming = false } }
        .fullScreenCover(isPresented: $showTutorial) { TutorialView { TutorialStore().seen = true; showTutorial = false } }
        .sheet(isPresented: $showRemoteAssist) { RemoteAssistView { showRemoteAssist = false } }
        .sheet(isPresented: $showNavigation) { WalkNavigationView { showNavigation = false } }
        .sheet(isPresented: $showMessages) { ConversationsView(session: session) }
        .sheet(isPresented: $showLocation) { NavigationStack { LiveLocationView(isBlind: true) } }
        .sheet(isPresented: $showFamily) {
            NavigationStack {
                FamilyLinksView()
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button(SettingsStrings.done(lang)) { showFamily = false } } }
            }
        }
        .sheet(isPresented: $showRecordings) {
            NavigationStack {
                MyRecordingsView()
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button(SettingsStrings.done(lang)) { showRecordings = false } } }
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView(store: consentStore) { showSettings = false } }
    }

    // MARK: Hub 内容

    private var hubContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BeeSpacing.lg) {
                topStrip
                greetingBlock
                primaryHelp
                moveSection
                seeSection
                connectSection
                Color.clear.frame(height: BeeSpacing.xl) // 底部安全留白
            }
            .padding()
        }
    }

    // 1) 顶部条：语音 / 消息 / 设置（固定顺序，肌肉记忆）。
    private var topStrip: some View {
        HStack(alignment: .center, spacing: BeeSpacing.sm) {
            BeeStatusPill(text: HomeStrings.ready(lang))
            Spacer()
            micButton
            messagesButton
            settingsButton
        }
    }

    // 2) 问候。
    private var greetingBlock: some View {
        VStack(alignment: .leading, spacing: BeeSpacing.xs) {
            Text(HomeStrings.greeting(session.user?.displayName, hour: currentHour, lang))
                .font(.largeTitle.bold()).foregroundStyle(.white)
            Text(HomeStrings.greetingHint(lang))
                .font(.subheadline).foregroundStyle(.white.opacity(0.7))
                .accessibilityHidden(true) // 已在落地时朗读，省一次右滑
        }
        .padding(.vertical, BeeSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(HomeStrings.greeting(session.user?.displayName, hour: currentHour, lang))
    }

    // 3) 首要操作：求助（唯一暖色填充）。
    private var primaryHelp: some View {
        BeeBigButton(HomeStrings.helpTitle(lang), systemImage: "hand.raised.fill",
                     subtitle: HomeStrings.helpSubtitle(lang), tint: .beeHoney) {
            requestRemoteHelp() // 关闭时不禁用：requestRemoteHelp 会朗读「该功能暂时关闭」，与双指双击求助一致
        }
        .opacity(helpEnabled ? 1 : 0.5)
        .accessibilityHint(helpEnabled ? HomeStrings.magicTapHint(lang) : HomeStrings.featureOff(lang))
    }

    // 4) 出行：导盲避障 + 步行导航。
    private var moveSection: some View {
        VStack(alignment: .leading, spacing: BeeSpacing.sm) {
            sectionHeader(HomeStrings.sectionMove(lang), "MOVE")
            HStack(spacing: BeeSpacing.sm) {
                tile(HomeStrings.tileObstacle(lang), systemImage: "figure.walk",
                     hint: HomeStrings.hintObstacle(lang),
                     disabledReason: hasLiDAR ? nil : HomeStrings.noLiDARMessage(lang), minHeight: 116) { enterObstacle() }
                tile(HomeStrings.tileNav(lang), systemImage: "signpost.right.fill",
                     hint: HomeStrings.hintNav(lang),
                     disabledReason: session.features.navigation ? nil : HomeStrings.featureOff(lang), minHeight: 116) { showNavigation = true }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(HomeStrings.sectionMove(lang))
    }

    // 5) 看见：看一看 + 天气 + 环境感知四键。
    private var seeSection: some View {
        VStack(alignment: .leading, spacing: BeeSpacing.sm) {
            sectionHeader(HomeStrings.sectionSee(lang), "SEE")
            HStack(spacing: BeeSpacing.sm) {
                tile(HomeStrings.tileLook(lang), systemImage: "viewfinder",
                     hint: HomeStrings.hintLook(lang),
                     disabledReason: session.features.sceneScan ? nil : HomeStrings.featureOff(lang)) { showFraming = true }
                tile(HomeStrings.tileWeather(lang), systemImage: "cloud.sun.fill",
                     hint: HomeStrings.hintWeather(lang)) { weatherSpeaker.announce() }
            }
            VStack(spacing: BeeSpacing.sm) {
                HStack(spacing: BeeSpacing.sm) {
                    tile(HomeStrings.tileWhereAmI(lang), systemImage: "location.fill",
                         hint: HomeStrings.hintWhereAmI(lang)) { locationDescriber.describe() }
                    tile(HomeStrings.tileAround(lang), systemImage: "dot.circle.viewfinder",
                         hint: HomeStrings.hintAround(lang)) { locationDescriber.describeAround() }
                }
                tile(HomeStrings.tileAhead(lang), systemImage: "arrow.up.circle",
                     hint: HomeStrings.hintAhead(lang)) { locationDescriber.describeAhead() }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(HomeStrings.envGroup(lang))
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(HomeStrings.sectionSee(lang))
    }

    // 6) 联系：消息 + 实时位置 + 亲友与紧急 + 我的录音（后两者从设置移上来，作为主要功能）。
    private var connectSection: some View {
        VStack(alignment: .leading, spacing: BeeSpacing.sm) {
            sectionHeader(HomeStrings.sectionConnect(lang), "CONNECT")
            HStack(spacing: BeeSpacing.sm) {
                tile(ChatStrings.navTitle(lang), systemImage: "bubble.left.and.bubble.right.fill",
                     hint: nil, disabledReason: session.features.messaging ? nil : HomeStrings.featureOff(lang),
                     badge: unreadTotal) { showMessages = true }
                tile(HomeStrings.tileLocShare(lang), systemImage: "location.fill.viewfinder",
                     hint: HomeStrings.hintLocShare(lang),
                     disabledReason: session.features.locationSharing ? nil : HomeStrings.featureOff(lang)) { showLocation = true }
            }
            HStack(spacing: BeeSpacing.sm) {
                tile(HomeStrings.tileFamily(lang), systemImage: "person.2.fill",
                     hint: HomeStrings.hintFamily(lang)) { showFamily = true }
                tile(HomeStrings.tileRecordings(lang), systemImage: "waveform.circle.fill",
                     hint: HomeStrings.hintRecordings(lang)) { showRecordings = true }
            }
            // SOS 可视入口：自动摔倒检测/语音"救命"之外的第三条路（嘈杂环境语音可能识别不了、
            // 轻摔可能不触发检测）。manualSOS 自带 30s 倒计时+响亮播报+可取消覆盖层，误触安全；
            // 不设 feature 门控——紧急告警端点本就不受功能开关约束（安全底线不可被关停）。
            tile(HomeStrings.tileSOS(lang), systemImage: "sos.circle.fill",
                 hint: HomeStrings.hintSOS(lang)) { emergency.manualSOS() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(HomeStrings.sectionConnect(lang))
    }

    // MARK: 复用组件

    private func sectionHeader(_ title: String, _ caption: String) -> some View {
        HStack(spacing: 8) {
            Text(title).font(.headline).foregroundStyle(.white)
            Text("· \(caption)").font(.caption.weight(.semibold)).foregroundStyle(.white.opacity(0.45)).tracking(1)
        }
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(title)
    }

    /// 方块磁贴：深底白字 + 蜂蜜黄图标；超大点按区。
    /// 功能关闭/不支持时不用 `.disabled`（VoiceOver 关闭时禁用按钮点了毫无反馈）——而是变暗但仍可点，
    /// 点按时朗读原因（`disabledReason`，如「该功能暂时关闭」/「需要带 LiDAR 的设备」），与求助按钮一致。
    private func tile(_ title: String, systemImage: String, hint: String? = nil, disabledReason: String? = nil,
                      minHeight: CGFloat = 104, badge: Int = 0, action: @escaping () -> Void) -> some View {
        Button {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            if let disabledReason {
                SpeechHub.shared.speak(disabledReason, channel: .query, voiceCode: lang.voiceCode)
            } else {
                action()
            }
        } label: {
            VStack(spacing: BeeSpacing.sm) {
                Image(systemName: systemImage).font(.system(size: 32, weight: .bold)).foregroundStyle(Color.beeHoney)
                Text(title).font(.title3.weight(.semibold)).foregroundStyle(.white)
                    .minimumScaleFactor(0.7).lineLimit(1)
            }
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .background(Color.beeInk.opacity(wantsSolidSurfaces ? 1 : 0.78),
                        in: RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous)
                .strokeBorder(.white.opacity(0.12), lineWidth: 0.5))
            .overlay(alignment: .topTrailing) {
                if badge > 0 {
                    Text("\(min(badge, 99))").font(.caption2.bold()).foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.beeDanger, in: Capsule()).padding(8)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous))
        }
        .buttonStyle(BeePressStyle())
        .opacity(disabledReason == nil ? 1 : 0.5)
        .accessibilityLabel(badge > 0 ? "\(title)，\(ChatStrings.unreadBadgeA11y(badge, lang))" : title)
        .modifier(OptionalHubHint(hint: disabledReason ?? hint))
    }

    private var micButton: some View {
        Button {
            voice.toggle { command, transcript in handleVoiceCommand(command, transcript: transcript) }
        } label: {
            Image(systemName: voice.isListening ? "waveform.circle.fill" : "mic.fill").font(.title2).padding(12)
                .background(voice.isListening ? AnyShapeStyle(Color.beeDanger)
                            : (wantsSolidSurfaces ? AnyShapeStyle(Color.beeInk) : AnyShapeStyle(.ultraThinMaterial)), in: Circle())
                .foregroundStyle(.white)
        }
        .buttonStyle(BeePressStyle())
        .accessibilityLabel(HomeStrings.voiceButton(lang))
        .accessibilityHint(HomeStrings.voiceButtonHint(lang))
    }

    private var messagesButton: some View {
        Button {
            if session.features.messaging { showMessages = true }
            else { SpeechHub.shared.speak(HomeStrings.featureOff(lang), channel: .query, voiceCode: lang.voiceCode) }
        } label: {
            Image(systemName: "bubble.left.and.bubble.right.fill").font(.title2).padding(12)
                .background(wantsSolidSurfaces ? AnyShapeStyle(Color.beeInk) : AnyShapeStyle(.ultraThinMaterial), in: Circle())
                .foregroundStyle(.white)
                .overlay(alignment: .topTrailing) {
                    if unreadTotal > 0 {
                        Text("\(min(unreadTotal, 99))").font(.caption2.bold()).foregroundStyle(.white)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color.beeDanger, in: Capsule()).accessibilityHidden(true)
                    }
                }
        }
        .buttonStyle(BeePressStyle())
        .opacity(session.features.messaging ? 1 : 0.5)
        .disabled(!session.features.messaging)
        .accessibilityLabel(ChatStrings.messagesButton(lang) + (unreadTotal > 0 ? "，" + ChatStrings.unreadBadgeA11y(unreadTotal, lang) : ""))
        .accessibilityHint(session.features.messaging ? "" : HomeStrings.featureOff(lang))
    }

    private var settingsButton: some View {
        Button { showSettings = true } label: {
            Image(systemName: "gearshape.fill").font(.title2).padding(12)
                .background(wantsSolidSurfaces ? AnyShapeStyle(Color.beeInk) : AnyShapeStyle(.ultraThinMaterial), in: Circle())
                .foregroundStyle(.white)
        }
        .buttonStyle(BeePressStyle())
        .accessibilityLabel(HomeStrings.tileSettings(lang))
    }

    // MARK: 摔倒/撞击警报卡

    private var emergencyOverlay: some View {
        ZStack {
            Color.black.opacity(0.86).ignoresSafeArea()
            VStack(spacing: BeeSpacing.lg) {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 56)).foregroundStyle(Color.beeWarn)
                Text(HomeStrings.fallAlertTitle(lang)).font(.title.bold()).foregroundStyle(.white)
                switch emergency.phase {
                case .countdown(_, let seconds):
                    Text("\(seconds)").font(.system(size: 64, weight: .heavy)).foregroundStyle(Color.beeHoney).accessibilityHidden(true)
                    BeeBigButton(HomeStrings.imOK(lang), systemImage: "checkmark.circle.fill", tint: .beeSuccess, foreground: .white) { emergency.cancel() }
                    BeeBigButton(HomeStrings.notifyNow(lang), systemImage: "bell.badge.fill", tint: .beeDanger, foreground: .white) { emergency.sendNow() }
                case .sending:
                    ProgressView().tint(.white).scaleEffect(1.6)
                case .sent(let n):
                    Text(HomeStrings.fallAlertSent(n, lang)).font(.title3).foregroundStyle(.white).multilineTextAlignment(.center).padding(.horizontal)
                    // 告警已发出后报平安：广播解除，让刚收到告警而担心/正赶来的亲友立刻安心（安全类 all-clear 闭环）。
                    BeeBigButton(HomeStrings.allClearButton(lang), systemImage: "checkmark.circle.fill", tint: .beeSuccess, foreground: .white) { emergency.allClear() }
                case .failed:
                    Text(HomeStrings.fallAlertFailed(lang)).font(.title3).foregroundStyle(.white).multilineTextAlignment(.center).padding(.horizontal)
                    BeeBigButton(HomeStrings.helpTitle(lang), systemImage: "hand.raised.fill", tint: .beeHoney) { requestRemoteHelp() }
                case .idle:
                    EmptyView()
                }
            }
            .padding()
        }
        .accessibilityAction(.magicTap) { emergency.cancel() }
    }

    // MARK: 逻辑

    private var currentHour: Int { Calendar.current.component(.hour, from: Date()) }

    private func enterObstacle() {
        guard hasLiDAR else { SpeechHub.shared.speak(HomeStrings.noLiDARMessage(lang), channel: .query, voiceCode: lang.voiceCode); return }
        showObstacle = true
    }

    /// 求助守门：两种远程协助皆关时朗读"暂时关闭"，不弹空界面。
    private func requestRemoteHelp() {
        if helpEnabled { showRemoteAssist = true }
        else { SpeechHub.shared.speak(HomeStrings.featureOff(lang), channel: .query, voiceCode: lang.voiceCode) }
    }

    /// 收起本页所有呈现（紧急/来电时让最上层界面可见）。
    private func collapseAll() {
        showObstacle = false; showRemoteAssist = false; showNavigation = false
        showFraming = false; showMessages = false; showSettings = false; showLocation = false; showTutorial = false
        showFamily = false; showRecordings = false
    }

    private func onAppear() async {
        // 首启教程。
        let showingTutorial = !TutorialStore().seen
        if showingTutorial { showTutorial = true }
        // 落地一次性朗读问候 + 求助提醒（SpeechHub：VO 开走公告、未开走 TTS）。
        // 首启教程会自行朗读（同一语音通道），此时不念问候，避免开场两段语音抢话/重叠。
        if !didSpeakGreeting && !showingTutorial {
            didSpeakGreeting = true
            SpeechHub.shared.speak(HomeStrings.greetingSpeak(session.user?.displayName, hour: currentHour, lang), channel: .query, voiceCode: lang.voiceCode)
        }
        // 摔倒/撞击监测：Hub 存续期间持续运行（含进入导盲/识别/通话后台时段，手机在身上）。
        reconcileFallDetection()
        // 无网兜底拨号缓存的新鲜度：familyLinks 的既有加载点只有亲友页——很久不开亲友页的用户
        // 缓存会陈旧（换过紧急联系人/解绑）。这个缓存只在**最糟糕的时刻**（告警重试全败=无网）
        // 被读，读时无从修正，故进 Hub 就后台静默刷一次（失败无所谓，下次进 Hub 再试；
        // APIClient.familyLinks 内部会顺手更新 EmergencyDialCache）。
        Task.detached(priority: .utility) { [token = session.token] in
            guard let token else { return }
            _ = try? await APIClient().familyLinks(token: token)
        }
        // 未读消息角标。
        unreadPollTask?.cancel()
        unreadPollTask = Task {
            while !Task.isCancelled {
                if let token = session.token {
                    // 一次轻量汇总（替代各拉一遍会话+群列表）：messages=单聊+群聊未读。
                    unreadTotal = (try? await APIClient().unreadSummary(token: token))?.messages ?? unreadTotal
                }
                try? await Task.sleep(for: .seconds(15))
            }
        }
    }

    private func reconcileFallDetection() {
        if FeatureSettings().fallDetectionEnabled {
            motionMonitor.start { event in EmergencyAlertCenter.shared.trigger(event) }
        } else {
            motionMonitor.stop()
        }
    }

    // MARK: 语音指令路由

    private func handleVoiceCommand(_ command: VoiceCommand, transcript: String) {
        func speak(_ text: String) { SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode) }
        switch command {
        // 语音 SOS：摔倒后够不到屏幕也能喊"救命"触发告警。manualSOS 自带 30s 倒计时+响亮播报+可取消
        // 覆盖层（与摔倒检测同一套流程）——误触发有充分的撤销窗口，绝不静默直发。
        case .sos: emergency.manualSOS()
        case .help: requestRemoteHelp()
        case .guideMe: enterObstacle()
        case .whereAmI: locationDescriber.describe()
        case .around: locationDescriber.describeAround()
        case .ahead: locationDescriber.describeAhead()
        case .facing: locationDescriber.describeFacing()
        case .weather: weatherSpeaker.announce()
        case .look: showFraming = true
        case .readText: route.pendingChannel = .text; showFraming = true
        case .readDates: route.pendingChannel = .dates; showFraming = true // "保质期/生产日期"：读包装日期
        case .readFullPage: route.pendingChannel = .fullPage; showFraming = true
        case .banknote: route.pendingChannel = .banknote; showFraming = true
        case .scanCode: route.pendingChannel = .scan; showFraming = true
        case .readBus: route.pendingChannel = .bus; showFraming = true
        case .describePeople: route.pendingChannel = .people; showFraming = true
        case .readLight: route.pendingChannel = .light; showFraming = true
        case .readColor: route.pendingChannel = .color; showFraming = true
        case .matchColors: route.pendingChannel = .colorMatch; showFraming = true // "这两件搭不搭"：扫两次比配色
        case .find(let obj): route.pendingFind = obj; showFraming = true // 找具体物品（Framing 首帧据 resolver 派发）
        case .navigate(let dest):
            if let dest { AppRoute.shared.pendingNavAction = .search(dest) }
            showNavigation = true
        case .goHome:
            AppRoute.shared.pendingNavAction = .backtrack
            showNavigation = true
        case .messages: showMessages = true
        case .sendMessage(let to, let text): sendVoiceMessage(to: to, text: text)
        case .adjustSpeech(let adj):
            // 语音调语速（Hub 可达）：改设置 → 用**新语速**播确认（当场听到效果）；已到边界则提示不空调。
            if adj != .normal && SpeechRatePolicy.atLimit(FeatureSettings().speechRate, adj) {
                speak(HomeStrings.speechRateAtLimit(adj, lang))
            } else {
                var fs = FeatureSettings()
                let newRate = SpeechRatePolicy.adjusted(from: fs.speechRate, adj)
                fs.speechRate = newRate
                SpeechHub.shared.speak(HomeStrings.speechRateChanged(adj, lang), channel: .query, rate: newRate, voiceCode: lang.voiceCode)
            }
        case .adjustVerbosity(let dir):
            // 语音调详略（Hub 可达；FeedbackCoordinator 真读 verbosity 门控播报）：改设置 → 播确认（点明各档含义）。
            let cur = FeedbackVerbosity(rawValue: FeatureSettings().verbosity) ?? .full
            if cur.atLimit(dir) {
                speak(HomeStrings.verbosityAtLimit(dir, lang))
            } else {
                let next = cur.adjusted(dir)
                var fs = FeatureSettings(); fs.verbosity = next.rawValue
                speak(HomeStrings.verbosityChanged(next, lang))
            }
        case .commands: speak(HomeStrings.voiceCommandsHelp(lang)) // 能力自述：语音功能的语音说明书
        case .repeatLast: speak(HomeStrings.nothingToRepeat(lang)) // Hub 无避障会话可重复
        case .time:
            let f = DateFormatter(); f.locale = Locale(identifier: lang == .zh ? "zh_CN" : "en_US"); f.dateStyle = .none; f.timeStyle = .short
            speak(HomeStrings.timeSpeak(f.string(from: Date()), lang)) // 系统本地化短时间（盲人看不到时钟）
        case .date:
            let f = DateFormatter(); f.locale = Locale(identifier: lang == .zh ? "zh_CN" : "en_US"); f.dateStyle = .full; f.timeStyle = .none
            speak(HomeStrings.dateSpeak(f.string(from: Date()), lang)) // .full 含星期
        case .battery:
            UIDevice.current.isBatteryMonitoringEnabled = true
            let lvl = UIDevice.current.batteryLevel // 未知时为 -1（如未开监控/模拟器）
            let st = UIDevice.current.batteryState
            if lvl < 0 { speak(HomeStrings.batteryUnknown(lang)) }
            else { speak(HomeStrings.batterySpeak(percent: Int((lvl * 100).rounded()), charging: st == .charging || st == .full, lang)) }
        case .openSettings: showSettings = true // 语音直达设置（语言/无障碍/摔倒检测等非语音可调项）
        case .unknown:
            speak(transcript.isEmpty ? HomeStrings.voiceHeardNothing(lang) : HomeStrings.voiceNotUnderstood(lang))
        }
    }

    private func sendVoiceMessage(to name: String, text: String) {
        func speak(_ t: String) { SpeechHub.shared.speak(t, channel: .query, voiceCode: lang.voiceCode) }
        guard let token = session.token else { speak(HomeStrings.voiceNeedLogin(lang)); return }
        Task {
            let links = (try? await APIClient().familyLinks(token: token)) ?? []
            let accepted = links.filter { $0.isAccepted }
            let matches = accepted.filter { $0.memberName.localizedCaseInsensitiveContains(name) }
            guard matches.count == 1, let target = matches.first else {
                speak(HomeStrings.voiceNoContact(name, lang)); showMessages = true; return
            }
            if (try? await APIClient().sendMessage(token: token, toId: target.memberId, kind: "text", text: text)) != nil {
                speak(HomeStrings.voiceSent(target.memberName, lang))
            } else {
                speak(ChatStrings.sendFailed(lang))
            }
        }
    }
}

/// 可选 VoiceOver 提示修饰符（hint 为空则不加）。
private struct OptionalHubHint: ViewModifier {
    let hint: String?
    func body(content: Content) -> some View {
        if let hint { content.accessibilityHint(hint) } else { content }
    }
}
