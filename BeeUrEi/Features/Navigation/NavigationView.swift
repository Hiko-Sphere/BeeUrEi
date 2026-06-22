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
    let onClose: () -> Void

    /// 导航屏文案语言（E5）。
    private var lang: Language { FeatureSettings().language }

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

                Section(NavStrings.statusHeader(lang)) {
                    Text(model.status)
                    if !model.instruction.isEmpty {
                        Text(model.instruction).font(.headline)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(model.instruction.isEmpty ? model.status : "\(model.status)。\(model.instruction)")

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
                // 恢复上次地区；首次按系统区域自动判定（中国大陆→高德）。
                switch regionRaw {
                case "china": region = .china
                case "overseas": region = .overseas
                default: region = (Locale.current.region?.identifier == "CN") ? .china : .overseas
                }
            }
            // 任何方式关闭（完成/下滑/系统）都彻底停止导航——否则定位、信标音、语音引导会在后台继续（见 P1 审计）。
            .onDisappear { model.stop(); ScreenWake.release("nav") }
            // 语音指令直达："带我去X"→ 预填并直接开始导航；"原路返回"→ 一键回程。
            .task {
                guard let action = AppRoute.shared.pendingNavAction else { return }
                AppRoute.shared.pendingNavAction = nil
                switch action {
                case .search(let dest):
                    destination = dest
                    await model.start(destination: dest, region: region)
                case .backtrack:
                    model.startBacktrack()
                }
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(NavStrings.done(lang)) { onClose() } }
            }
        }
    }
}
