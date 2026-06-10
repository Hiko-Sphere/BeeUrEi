import SwiftUI

/// 步行导航界面。海外用 MapKit 实时转向；国内用高德（经后端）读出路线步骤。VoiceOver 友好。
struct WalkNavigationView: View {
    @State private var model = NavigationViewModel()
    @State private var destination = ""
    @State private var region: NavigationViewModel.Region = .overseas
    @State private var favorites: [String] = []
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("地区") {
                    Picker("地区", selection: $region) {
                        Text("海外（MapKit）").tag(NavigationViewModel.Region.overseas)
                        Text("中国大陆（高德）").tag(NavigationViewModel.Region.china)
                    }
                    .pickerStyle(.segmented)
                }

                Section("目的地") {
                    TextField("如：地铁站、超市名称", text: $destination)
                        .autocorrectionDisabled()
                    if !model.running {
                        Button("开始导航") {
                            let store = FavoritePlacesStore()
                            store.add(destination)
                            favorites = store.all
                            Task { await model.start(destination: destination, region: region) }
                        }
                        .disabled(destination.isEmpty)
                    } else {
                        Button("停止导航", role: .destructive) { model.stop() }
                    }
                }

                Section {
                    if !model.recordingTrail {
                        Button("开始记路") { model.startTrailRecording() }
                            .accessibilityHint("沿途记录你的来路，回程时可原路返回")
                    } else {
                        Button("停止记路", role: .destructive) { model.stopTrailRecording() }
                    }
                    if model.trailCount >= 2 {
                        Button("原路返回（已记 \(model.trailCount) 个点）") { model.startBacktrack() }
                            .accessibilityHint("沿记录的来路反向引导你走回出发点")
                    }
                } header: {
                    Text("原路返回")
                } footer: {
                    Text("进陌生地方前点「开始记路」；要回去时点「原路返回」，跟着提示音原路走回出发点。")
                }

                if !favorites.isEmpty {
                    Section("常用目的地") {
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

                Section("状态") {
                    Text(model.status)
                    if !model.instruction.isEmpty {
                        Text(model.instruction).font(.headline)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(model.instruction.isEmpty ? model.status : "\(model.status)。\(model.instruction)")

                if !model.steps.isEmpty {
                    Section("路线步骤") {
                        ForEach(Array(model.steps.enumerated()), id: \.offset) { idx, step in
                            Text("\(idx + 1). \(step)")
                        }
                    }
                }
            }
            .navigationTitle("步行导航")
            .onAppear { favorites = FavoritePlacesStore().all }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { onClose() } }
            }
        }
    }
}
