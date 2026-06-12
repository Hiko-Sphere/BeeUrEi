import SwiftUI

/// 步行导航界面。海外用 MapKit 实时转向；国内用高德（经后端）读出路线步骤。VoiceOver 友好。
struct WalkNavigationView: View {
    @State private var model = NavigationViewModel()
    @State private var destination = ""
    @State private var region: NavigationViewModel.Region = .overseas
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
                }

                Section(NavStrings.destinationHeader(lang)) {
                    TextField(NavStrings.destinationPlaceholder(lang), text: $destination)
                        .autocorrectionDisabled()
                    if model.previewing {
                        Button(NavStrings.stopPreview(lang), role: .destructive) { model.stopPreview() }
                    } else if !model.running {
                        Button(NavStrings.startNav(lang)) {
                            let store = FavoritePlacesStore()
                            store.add(destination)
                            favorites = store.all
                            Task { await model.start(destination: destination, region: region) }
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
            .onAppear { favorites = FavoritePlacesStore().all }
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
