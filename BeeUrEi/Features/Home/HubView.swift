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
    @State private var showCheckin = false        // 安全报到（出行安全日常功能，从亲友页三层深提升到 Hub 直达）
    @State private var showTutorial = false
    @State private var locationDescriber = LocationDescriber()
    @State private var weatherSpeaker = WeatherSpeaker()
    @State private var transitPlanner = TransitPlanner()
    @State private var motionMonitor = MotionMonitor()
    @State private var emergency = EmergencyAlertCenter.shared
    @State private var voice = VoiceCommandListener()
    @State private var incoming = IncomingCallCenter.shared
    @State private var route = AppRoute.shared
    @State private var unreadTotal = 0
    @State private var batteryWarner = LowBatteryWarner() // 主动低电量告警去抖（跌破 20%/10%/5% 各出声一次；5%=濒断电再紧急一次）
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
        // 主动低电量告警：盲人看不到电量图标，手机没电=同时失去导盲/导航/求助。电量或充电状态一变即检查，
        // 跌破 20%/10% 各出声一次（LowBatteryWarner 去抖）。拔充电器(state 变)也复检，避免拔线后漏警。
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.batteryLevelDidChangeNotification)) { _ in checkBattery() }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.batteryStateDidChangeNotification)) { _ in checkBattery() }
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
        .sheet(isPresented: $showCheckin) {
            NavigationStack {
                if let token = session.token ?? KeychainStore.read() {
                    SafetyCheckInView(token: token)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button(SettingsStrings.done(lang)) { showCheckin = false } } }
                } else {
                    Text(HomeStrings.voiceNeedLogin(lang)).padding() // 理论不可达（Hub 已登录态）；防御兜底
                }
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
            // 安全报到直达（dead-man's switch）：出行安全的日常动作，此前埋在 亲友页 三层深——与位置/录音/亲友
            // 提升 Hub 同一先例。出发设时限、回来"报平安"（语音 iter336 已接）；到点未报自动通知紧急联系人。
            tile(HomeStrings.tileCheckin(lang), systemImage: "checkmark.shield.fill",
                 hint: HomeStrings.hintCheckin(lang)) { showCheckin = true }
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
        UIDevice.current.isBatteryMonitoringEnabled = true // 主动低电量告警需要，且不影响其它电量读取
        checkBattery() // 进 Hub 即检查一次：开 App 时已低电就当即提醒，不等下一次 1% 变化
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

    /// 检查电量，跌破 20%/10% 各主动出声一次（去抖在 LowBatteryWarner）。未知电量(-1)不播。
    /// 用 .query 通道：让位于避障/导航等安全播报，繁忙时排队、不打断更紧要的提示。
    private func checkBattery() {
        let lvl = UIDevice.current.batteryLevel
        guard lvl >= 0 else { return } // 未知（未开监控/模拟器）：不猜不播
        let pct = Int((lvl * 100).rounded())
        let st = UIDevice.current.batteryState
        if let alert = batteryWarner.update(percent: pct, charging: st == .charging || st == .full) {
            SpeechHub.shared.speak(HomeStrings.lowBatterySpeak(percent: pct, critical: alert == .critical, lang),
                                   channel: .query, voiceCode: lang.voiceCode)
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
        // 定向呼叫具体亲友（"给妈妈打电话"）：与 .help 同一求助界面，但预置待拨名字，进入后自动按名拨打。
        case .callContact(let name):
            if helpEnabled { route.pendingCallName = name; showRemoteAssist = true }
            else { speak(HomeStrings.featureOff(lang)) }
        case .guideMe: enterObstacle()
        case .whereAmI: locationDescriber.describe()
        case .around: locationDescriber.describeAround()
        case .ahead: locationDescriber.describeAhead()
        case .facing: locationDescriber.describeFacing()
        case .findNearest(let cat): locationDescriber.findNearest(cat) // 「最近的厕所/药店」就近找地点
        case .weather: weatherSpeaker.announce()
        case .look: showFraming = true
        case .readText: route.pendingChannel = .text; showFraming = true
        case .readDates: route.pendingChannel = .dates; showFraming = true // "保质期/生产日期"：读包装日期
        case .readPhone: route.pendingChannel = .phone; showFraming = true // "读电话号码"：读名片/海报号码
        case .readEmail: route.pendingChannel = .email; showFraming = true // "读邮箱"：读名片/信笺邮箱
        case .readFullPage: route.pendingChannel = .fullPage; showFraming = true
        case .banknote: route.pendingChannel = .banknote; showFraming = true
        case .countCash: route.pendingChannel = .countCash; showFraming = true // "数一叠钱"直达点钞模式
        case .scanCode: route.pendingChannel = .scan; showFraming = true
        case .readBus: route.pendingChannel = .bus; showFraming = true
        case .describePeople: route.pendingChannel = .people; showFraming = true
        case .describeScene: route.pendingChannel = .sceneAI; showFraming = true // "描述场景"：云端 AI 详细描述眼前画面（对标 Be My AI）
        case .readLight: route.pendingChannel = .light; showFraming = true
        case .readColor: route.pendingChannel = .color; showFraming = true
        case .matchColors: route.pendingChannel = .colorMatch; showFraming = true // "这两件搭不搭"：扫两次比配色
        case .find(let obj): route.pendingFind = obj; showFraming = true // 找具体物品（Framing 首帧据 resolver 派发）
        case .navigate(let dest):
            if let dest { AppRoute.shared.pendingNavAction = .search(dest) }
            showNavigation = true
        case .transit(let dest):
            // 「坐公交去公司/回家」：目的地是家/公司词时，用**保存的地址**规划（否则字面"公司"会命中随便一家公司/搜不到，
            // 与步行 navigateWork 同口径）；普通地名照常按名规划。语音直接朗读整段公交路线。
            if let label = VoiceCommandParser.savedPlaceLabel(forDestination: dest) {
                transitToSaved(label: label, literalFallback: dest)
            } else {
                transitPlanner.plan(to: dest)
            }
        case .goHome:
            AppRoute.shared.pendingNavAction = .backtrack
            showNavigation = true
        // 「走X路线」：人工踩好的路线是最安全的导航，语音直达（匹配/歧义/未找到都在导航屏语音反馈）。
        case .savedRoute(let name):
            AppRoute.shared.pendingNavAction = .savedRoute(name)
            showNavigation = true
        // 「结束导航」：走路的盲人想停下时找不到屏上按钮，语音直达。关掉导航 sheet→其 onDisappear 已 model.stop()（干净停）。
        // 没在导航时如实告知，不静默（盲人无从确认命令是否生效）。只停导航，绝不涉及挂断求助。
        case .stopNavigation:
            if showNavigation { showNavigation = false; speak(HomeStrings.navStoppedSpeak(lang)) }
            else { speak(HomeStrings.navNotActiveSpeak(lang)) }
        case .navigateHome: navigateToSaved(label: "home") // 「回家」：导航到已保存的家地址
        case .navigateWork: navigateToSaved(label: "work") // 「去公司」：导航到已保存的公司地址
        case .messages: showMessages = true
        case .readMessages: readVoiceMessages()
        case .sendMessage(let to, let text): sendVoiceMessage(to: to, text: text)
        case .sendLocation(let to): sendVoiceLocation(to: to)
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
        // 报平安（安全报到 complete）：到点前手在盲杖上，语音是最该有的完成通道；漏报会给亲友发假告警。
        // 服务端幂等：进行中→结束并确认；已到期告警→等价 all-clear 解除；都没有→completed:false 如实告知。
        case .checkinSafe: Task { await reportSafeByVoice() }
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

    /// 语音"读消息"：拉取会话列表 → 汇报有未读的最新一条（对标 Siri「读消息」，盲人不必进聊天界面逐条滑）。
    /// 「回家/去公司」：拉已保存地点 → 有则导航到其地址（步行导航实时 geocode），无则提示去设置里添加。
    private func navigateToSaved(label: String) {
        func speak(_ t: String) { SpeechHub.shared.speak(t, channel: .query, voiceCode: lang.voiceCode) }
        guard let token = session.token else { speak(HomeStrings.voiceNeedLogin(lang)); return }
        let isHome = label == "home"
        Task {
            let places = (try? await APIClient().savedPlaces(token: token)) ?? []
            await MainActor.run {
                if let p = places.first(where: { $0.label == label }), !p.address.isEmpty {
                    speak(isHome ? HomeStrings.navigatingHome(lang) : HomeStrings.navigatingWork(lang))
                    AppRoute.shared.pendingNavAction = .search(p.address)
                    showNavigation = true
                } else {
                    speak(isHome ? HomeStrings.noHomeSet(lang) : HomeStrings.noWorkSet(lang))
                }
            }
        }
    }

    /// 「坐公交去公司/回家」：用**保存的**家/公司地址规划公交（非字面"公司"，避免命中随便一家公司/搜不到）。
    /// 没存该地点/未登录 → 退回按字面词规划（至少试一次；对"家"这类必失败的字面词由 transit 端点如实报"找不到目的地"）。
    private func transitToSaved(label: String, literalFallback: String) {
        guard let token = session.token else { transitPlanner.plan(to: literalFallback); return }
        Task {
            let places = (try? await APIClient().savedPlaces(token: token)) ?? []
            await MainActor.run {
                if let p = places.first(where: { $0.label == label }), !p.address.isEmpty {
                    transitPlanner.plan(to: p.address) // 用保存的地址（真实地名）规划公交
                } else {
                    transitPlanner.plan(to: literalFallback) // 没存则退回字面词
                }
            }
        }
    }

    private func readVoiceMessages() {
        func speak(_ t: String) { SpeechHub.shared.speak(t, channel: .query, voiceCode: lang.voiceCode) }
        guard let token = session.token else { speak(HomeStrings.voiceNeedLogin(lang)); return }
        Task {
            // 单聊 + 群聊都要读（未读角标口径含两者；只读单聊会漏群未读、与角标不符）。两请求并发，任一失败即兜底。
            async let directCall = APIClient().conversations(token: token)
            async let groupCall = APIClient().groups(token: token)
            let direct = try? await directCall
            let groups = try? await groupCall
            guard direct != nil || groups != nil else { speak(HomeStrings.voiceReadFailed(lang)); return }
            var withTime: [(item: HomeStrings.UnreadConversation, at: Int)] = []
            for c in direct ?? [] where c.unread > 0 {
                withTime.append((HomeStrings.UnreadConversation(name: c.peer.displayName, kind: c.last.kind, text: c.last.text, unread: c.unread), c.last.createdAt))
            }
            for g in groups ?? [] where g.unread > 0 {
                guard let last = g.last else { continue } // 有未读必有最新一条；防御性跳过空群
                withTime.append((HomeStrings.UnreadConversation(name: g.group.name, kind: last.kind, text: last.text, unread: g.unread, isGroup: true), last.createdAt))
            }
            let items = withTime.sorted { $0.at > $1.at }.map(\.item) // 最新的未读会话先读
            speak(HomeStrings.unreadReadout(items, lang))
        }
    }

    /// 语音"报平安"：结束进行中的安全报到（已到期告警则等价 all-clear 解除）。到点前人在路上、手在盲杖上，
    /// 语音是最该有的完成通道——漏报会给亲友发假告警。服务端幂等：没有进行中的报到→completed:false，
    /// 如实告知（绝不假装已报）；失败给替代路径（亲友页手动点），绝不静默。
    private func reportSafeByVoice() async {
        func speak(_ t: String) { SpeechHub.shared.speak(t, channel: .query, voiceCode: lang.voiceCode) }
        guard let token = session.token ?? KeychainStore.read() else { speak(HomeStrings.voiceNeedLogin(lang)); return }
        do {
            let completed = try await APIClient().completeSafetyCheckin(token: token)
            speak(completed ? SafetyStrings.safeConfirm(lang) : SafetyStrings.noActiveCheckin(lang))
        } catch {
            speak(SafetyStrings.reportSafeFailed(lang))
        }
    }

    /// 语音"把我的位置发给X"：解析收件人（联系人+群，R64 同款）→ 取一次精确定位+反查地址 →
    /// 以聊天位置消息发出（与聊天页"发送位置"按钮同链路：kind=text + Apple 地图链接，接收端渲染为位置卡）。
    /// 盲人免进聊天找按钮，一句话共享位置；定位失败/找不到人都有语音反馈，绝不静默。
    private func sendVoiceLocation(to name: String) {
        func speak(_ t: String) { SpeechHub.shared.speak(t, channel: .query, voiceCode: lang.voiceCode) }
        guard let token = session.token else { speak(HomeStrings.voiceNeedLogin(lang)); return }
        Task {
            async let linksCall = APIClient().familyLinks(token: token)
            async let groupsCall = APIClient().groups(token: token)
            let links = (try? await linksCall) ?? []
            let groups = (try? await groupsCall) ?? []
            let contacts = links.filter { $0.isAccepted }.map { (id: $0.memberId, name: $0.memberName) }
            let groupList = groups.map { (id: $0.group.id, name: $0.group.name) }
            guard let target = HomeStrings.resolveVoiceRecipient(name: name, contacts: contacts, groups: groupList) else {
                speak(HomeStrings.voiceNoContact(name, lang)); showMessages = true; return
            }
            speak(ChatStrings.locatingNow(lang)) // 定位需要几秒，先告知在做什么（不静默）
            guard let payload = await LocationShareFetcher().fetch() else {
                speak(ChatStrings.locationFailed(lang)); return
            }
            let sent = target.isGroup
                ? (try? await APIClient().sendGroupMessage(token: token, groupId: target.id, kind: "text", text: payload.asText()))
                : (try? await APIClient().sendMessage(token: token, toId: target.id, kind: "text", text: payload.asText()))
            speak(sent != nil ? HomeStrings.voiceLocationSent(target.name, lang) : ChatStrings.sendFailed(lang))
        }
    }

    private func sendVoiceMessage(to name: String, text: String) {
        func speak(_ t: String) { SpeechHub.shared.speak(t, channel: .query, voiceCode: lang.voiceCode) }
        guard let token = session.token else { speak(HomeStrings.voiceNeedLogin(lang)); return }
        Task {
            // 联系人 + 群都可作收件人（能读群消息就该能发群消息，口径一致）。并发拉取，在两者里唯一匹配名字。
            async let linksCall = APIClient().familyLinks(token: token)
            async let groupsCall = APIClient().groups(token: token)
            let links = (try? await linksCall) ?? []
            let groups = (try? await groupsCall) ?? []
            let contacts = links.filter { $0.isAccepted }.map { (id: $0.memberId, name: $0.memberName) }
            let groupList = groups.map { (id: $0.group.id, name: $0.group.name) }
            guard let target = HomeStrings.resolveVoiceRecipient(name: name, contacts: contacts, groups: groupList) else {
                speak(HomeStrings.voiceNoContact(name, lang)); showMessages = true; return
            }
            let sent = target.isGroup
                ? (try? await APIClient().sendGroupMessage(token: token, groupId: target.id, kind: "text", text: text))
                : (try? await APIClient().sendMessage(token: token, toId: target.id, kind: "text", text: text))
            speak(sent != nil ? HomeStrings.voiceSent(target.name, lang) : ChatStrings.sendFailed(lang))
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
