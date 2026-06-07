import SwiftUI

/// 步行导航界面。海外用 MapKit 实时转向；国内用高德（经后端）读出路线步骤。VoiceOver 友好。
struct WalkNavigationView: View {
    @State private var model = NavigationViewModel()
    @State private var destination = ""
    @State private var region: NavigationViewModel.Region = .overseas
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
                            Task { await model.start(destination: destination, region: region) }
                        }
                        .disabled(destination.isEmpty)
                    } else {
                        Button("停止导航", role: .destructive) { model.stop() }
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
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { onClose() } }
            }
        }
    }
}
