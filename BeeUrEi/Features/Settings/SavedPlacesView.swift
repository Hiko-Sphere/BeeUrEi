import SwiftUI

/// 常用地点（家/公司）：填一次地址，之后语音"回家/去公司"即可直达（步行导航实时 geocode，故只存地址字符串）。
/// 盲人日常通勤刚需——免每次报完整地址。自定义地点（医院/超市）服务端已支持，UI 后续可扩展。
struct SavedPlacesView: View {
    @Environment(AuthSession.self) private var session
    private var lang: Language { FeatureSettings().language }
    @State private var home = ""
    @State private var work = ""
    @State private var loaded = false
    @State private var status = ""

    var body: some View {
        Form {
            placeSection(header: SettingsStrings.homeHeader(lang),
                         placeholder: SettingsStrings.homeAddressPlaceholder(lang),
                         text: $home, saveTitle: SettingsStrings.saveHome(lang), label: "home")
            placeSection(header: SettingsStrings.workHeader(lang),
                         placeholder: SettingsStrings.workAddressPlaceholder(lang),
                         text: $work, saveTitle: SettingsStrings.saveWork(lang), label: "work")
            Section { Text(SettingsStrings.savedPlacesFooter(lang)).font(.footnote).foregroundStyle(.secondary) }
            if !status.isEmpty {
                Section { Text(status).font(.footnote).foregroundStyle(.secondary)
                    .accessibilityAddTraits(.updatesFrequently) }
            }
        }
        .navigationTitle(SettingsStrings.savedPlacesTitle(lang))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder private func placeSection(header: String, placeholder: String, text: Binding<String>,
                                           saveTitle: String, label: String) -> some View {
        Section(header) {
            TextField(placeholder, text: text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
            HStack {
                Button(saveTitle) { save(label: label, address: text.wrappedValue) }
                    .disabled(text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Spacer()
                if !text.wrappedValue.isEmpty {
                    Button(SettingsStrings.clearPlace(lang), role: .destructive) { clear(label: label, text: text) }
                }
            }
        }
    }

    private func load() async {
        guard let token = session.token, !loaded else { return }
        loaded = true
        if let places = try? await APIClient().savedPlaces(token: token) {
            home = places.first(where: { $0.label == "home" })?.address ?? ""
            work = places.first(where: { $0.label == "work" })?.address ?? ""
        }
    }

    private func save(label: String, address: String) {
        let a = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let token = session.token, !a.isEmpty else { return }
        Task {
            do {
                try await APIClient().setSavedPlace(token: token, label: label, address: a)
                await MainActor.run { status = SettingsStrings.placeSaved(lang) }
            } catch {
                await MainActor.run { status = SettingsStrings.placeSaveFailed(lang) }
            }
        }
    }

    private func clear(label: String, text: Binding<String>) {
        guard let token = session.token else { return }
        Task {
            try? await APIClient().deleteSavedPlace(token: token, label: label)
            await MainActor.run { text.wrappedValue = ""; status = SettingsStrings.placeCleared(lang) }
        }
    }
}
