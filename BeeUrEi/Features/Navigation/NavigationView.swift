import SwiftUI

/// 步行导航界面。海外用 MapKit 实时转向；国内用高德（经后端）读出路线步骤。VoiceOver 友好。
struct WalkNavigationView: View {
    @State private var model = NavigationViewModel()
    @State private var destination = ""
    @State private var region: NavigationViewModel.Region = .overseas
    /// 记住上次所选地区（默认按系统区域自动判定：中国大陆→高德，否则海外 MapKit）——
    /// 避免国内用户用语音"带我去X"时被错误的海外引擎路由（见 P2 审计）。
    @AppStorage("nav.region") private var regionRaw = ""
    @State private var favorites: [String] = []
    // 路线库（亲友编排/自存，服务端）：仅列可执行的（role=owner）；加载失败显示可点重试行。
    @State private var savedRoutes: [APIClient.SavedRouteInfo] = []
    @State private var routesFailed = false
    @State private var routesLoaded = false // 首次加载完成前不显示"还没有路线"终态（避免对 VoiceOver 断言式误报）
    let onClose: () -> Void

    /// 导航屏文案语言（E5）。
    private var lang: Language { FeatureSettings().language }
    /// 距离单位（公制/英制，随设置）——路线库副标题的里程随之切换。
    private var unit: DistanceUnit { FeatureSettings().distanceUnit }

    /// 拉路线库：只留我可执行的（role=owner）。失败置重试行，绝不让加载态卡住页面。
    private func loadRoutes() async {
        guard let token = KeychainStore.read() else { return }
        do {
            savedRoutes = try await APIClient().listSavedRoutes(token: token).filter { $0.role == "owner" }
            routesFailed = false
        } catch {
            routesFailed = true
        }
        routesLoaded = true
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(NavStrings.regionHeader(lang)) {
                    Picker(NavStrings.regionHeader(lang), selection: $region) {
                        Text(NavStrings.regionOverseas(lang)).tag(NavigationViewModel.Region.overseas)
                        Text(NavStrings.regionChina(lang)).tag(NavigationViewModel.Region.china)
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: region) { _, r in regionRaw = (r == .china ? "china" : "overseas") } // 记住选择
                }

                Section(NavStrings.destinationHeader(lang)) {
                    TextField(NavStrings.destinationPlaceholder(lang), text: $destination)
                        .autocorrectionDisabled()
                    if model.previewing {
                        Button(NavStrings.stopPreview(lang), role: .destructive) { model.stopPreview() }
                    } else if !model.running {
                        Button(NavStrings.startNav(lang)) {
                            let dest = destination
                            Task {
                                await model.start(destination: dest, region: region)
                                // 仅当真的成功建立了路线才存入常用，避免把找不到的垃圾目的地存进收藏（见 P2 审计）。
                                if model.lastResolvedDestination == dest.trimmingCharacters(in: .whitespacesAndNewlines) {
                                    let store = FavoritePlacesStore(); store.add(dest); favorites = store.all
                                }
                            }
                        }
                        .disabled(destination.isEmpty)
                        Button(NavStrings.previewRoute(lang)) {
                            Task { await model.startPreview(destination: destination, region: region) }
                        }
                        .disabled(destination.isEmpty)
                        .accessibilityHint(NavStrings.previewHint(lang))
                    } else {
                        Button(NavStrings.stopNav(lang), role: .destructive) { model.stop() }
                    }
                }

                Section {
                    if !model.recordingTrail {
                        Button(NavStrings.startTrail(lang)) { model.startTrailRecording() }
                            .accessibilityHint(NavStrings.startTrailHint(lang))
                    } else {
                        Button(NavStrings.stopTrail(lang), role: .destructive) { model.stopTrailRecording() }
                    }
                    if model.trailCount >= 2 {
                        Button(NavStrings.backtrack(model.trailCount, lang)) { model.startBacktrack() }
                            .accessibilityHint(NavStrings.backtrackHint(lang))
                    }
                    // 轨迹持久存活（跨导航页开关），给用户主动清除入口（隐私 + 不想回这条旧路）。
                    if !model.recordingTrail && model.trailCount >= 2 {
                        Button(NavStrings.clearTrail(lang), role: .destructive) { model.clearTrail() }
                            .accessibilityHint(NavStrings.clearTrailHint(lang))
                    }
                } header: {
                    Text(NavStrings.backtrackHeader(lang))
                } footer: {
                    Text(NavStrings.backtrackFooter(lang))
                }

                if !favorites.isEmpty {
                    Section(NavStrings.favoritesHeader(lang)) {
                        ForEach(favorites, id: \.self) { place in
                            Button(place) {
                                destination = place
                                let store = FavoritePlacesStore()
                                store.add(place)
                                favorites = store.all
                                Task { await model.start(destination: place, region: region) }
                            }
                        }
                        .onDelete { idx in
                            let store = FavoritePlacesStore()
                            idx.map { favorites[$0] }.forEach { store.remove($0) }
                            favorites = store.all
                        }
                    }
                }

                // 我的路线（路线库）：亲友在网页端替我画的常走路线 + 我自存的；一键沿信标执行。
                Section(NavStrings.myRoutesHeader(lang)) {
                    if routesFailed {
                        Button { Task { await loadRoutes() } } label: {
                            Text(NavStrings.routesLoadFailedRetry(lang)).foregroundStyle(.secondary)
                        }
                        .accessibilityHint(NavStrings.routesRetryHint(lang))
                    } else if !routesLoaded {
                        Text(NavStrings.routesLoading(lang)).font(.footnote).foregroundStyle(.secondary)
                    } else if savedRoutes.isEmpty {
                        Text(NavStrings.routesEmpty(lang)).font(.footnote).foregroundStyle(.secondary)
                    } else {
                        ForEach(savedRoutes) { route in
                            let wps = route.waypoints.map { (lat: $0.lat, lon: $0.lng, note: $0.note) }
                            // 全程里程（相邻航点大圆距离和，核心 RouteRemaining，已测）——供副标题展示"这条多长/多久"。
                            let routeMeters = RouteRemaining.totalRouteMeters(waypoints: route.waypoints.map { Coordinate(lat: $0.lat, lon: $0.lng) })
                            VStack(alignment: .leading, spacing: 6) {
                                Button {
                                    model.startCustomRoute(name: route.name, waypoints: wps)
                                } label: {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(route.name)
                                        // "N 个路线点 · 约1.2 公里 · 步行约 17 分钟 · 由 X 创建"——信任透明(谁画的) + 里程/时长(多长多久)。
                                        Text(NavStrings.routeSubtitle(route.waypoints.count, meters: routeMeters, by: route.createdByName, unit: unit, lang))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                .accessibilityLabel(NavStrings.routeItemA11y(route.name, route.waypoints.count, meters: routeMeters, by: route.createdByName, unit: unit, lang))
                                // 出发前预览：不走路先试听全程（Soundscape 街景预览对齐）。
                                Button(NavStrings.previewRoute(lang)) {
                                    model.previewCustomRoute(name: route.name, waypoints: wps)
                                }
                                .font(.footnote)
                                .accessibilityHint(NavStrings.routePreviewHint(route.name, lang))
                            }
                        }
                    }
                }

                Section(NavStrings.statusHeader(lang)) {
                    Text(model.status)
                    if !model.instruction.isEmpty {
                        Text(model.instruction).font(.headline)
                    }
                    if !model.remaining.isEmpty {
                        Text(model.remaining).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel([model.status, model.instruction, model.remaining].filter { !$0.isEmpty }.joined(separator: "。"))

                // 可见"重听"按钮（导航中才显示）：Magic Tap 只是 VoiceOver 手势、不用 VoiceOver 的盲人无从触发；
                // 走路时随时点它重播"下一步 + 还有多远/ETA"（同 Magic Tap 调 statusRecap）。独立可点元素，不并入上面的状态标签。
                if model.running {
                    Section {
                        Button {
                            NavVoice.shared.speakCallout(NavStrings.statusRecap(instruction: model.instruction, remaining: model.remaining, status: model.status, arrivalClock: model.remainingArrivalClock, lang))
                        } label: {
                            Label(NavStrings.repeatStatus(lang), systemImage: "speaker.wave.2.fill")
                        }
                    }
                }

                if !model.steps.isEmpty {
                    Section(NavStrings.stepsHeader(lang)) {
                        ForEach(Array(model.steps.enumerated()), id: \.offset) { idx, step in
                            Text("\(idx + 1). \(step)")
                        }
                    }
                }
            }
            .navigationTitle(NavStrings.navScreenTitle(lang))
            .onAppear {
                ScreenWake.acquire("nav")   // 步行导航期间屏不灭（同 Apple/Google 地图）
                favorites = FavoritePlacesStore().all
                Task { await loadRoutes() }
                // 恢复上次地区；首次按系统区域自动判定（中国大陆→高德）。
                switch regionRaw {
                case "china": region = .china
                case "overseas": region = .overseas
                default: region = (Locale.current.region?.identifier == "CN") ? .china : .overseas
                }
            }
            // 任何方式关闭（完成/下滑/系统）都彻底停止导航——否则定位、信标音、语音引导会在后台继续（见 P1 审计）。
            .onDisappear { model.stop(); ScreenWake.release("nav") }
            // Magic Tap（双指双击屏幕任意处，VoiceOver 全局手势）：随时重播"下一步转向 + 还有多远/ETA"。
            // 此前剩余距离只在跨里程碑时自动播；走路的盲人想随时确认，只能去屏上找那行文字（不现实）。
            .accessibilityAction(.magicTap) {
                NavVoice.shared.speakCallout(NavStrings.statusRecap(instruction: model.instruction, remaining: model.remaining, status: model.status, arrivalClock: model.remainingArrivalClock, lang))
            }
            // 语音指令直达："带我去X"→ 预填并直接开始导航；"原路返回"→ 一键回程。
            .task {
                guard let action = AppRoute.shared.pendingNavAction else { return }
                AppRoute.shared.pendingNavAction = nil
                switch action {
                case .search(let dest):
                    destination = dest
                    await model.start(destination: dest, region: region)
                case .coordinate(let lat, let lon, let name):
                    // 聊天分享位置：导航到**精确坐标**，不按名字重搜（复审#8/#9）。name 仅填入搜索框供屏显。
                    destination = name
                    await model.start(toLat: lat, lon: lon, name: name, region: region)
                case .backtrack:
                    model.startBacktrack()
                case .savedRoute(let spoken):
                    // 语音"走X路线"：加载路线库 → 模糊匹配（SavedRouteMatcher，已测）→ 唯一命中即沿信标执行；
                    // 无匹配/歧义则读出全部路线名让用户再说（宁可不选也不选错——人工路线走错比没走上更危险）。
                    await loadRoutes()
                    if let i = SavedRouteMatcher.match(spoken: spoken, names: savedRoutes.map(\.name)) {
                        let route = savedRoutes[i]
                        model.startCustomRoute(name: route.name, waypoints: route.waypoints.map { (lat: $0.lat, lon: $0.lng, note: $0.note) })
                    } else {
                        NavVoice.shared.speakCallout(NavStrings.savedRouteNotFound(spoken, names: savedRoutes.map(\.name), lang))
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(NavStrings.done(lang)) { onClose() } }
            }
        }
    }
}
