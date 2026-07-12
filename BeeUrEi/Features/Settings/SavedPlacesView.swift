import SwiftUI

/// 常用地点（家/公司）：填一次地址，之后语音"回家/去公司"即可直达（步行导航实时 geocode，故只存地址字符串）。
/// 盲人日常通勤刚需——免每次报完整地址。自定义地点（医院/超市）服务端已支持，UI 后续可扩展。
/// 自定义地点保存前检查（纯函数可测，与 web iter141 同语义）：
/// - 同名编辑（label 未变）→ ok（就地改址）；
/// - 新 label 撞已有名 → duplicateName（须二次确认覆盖——否则静默覆盖别的围栏）；
/// - 编辑中改了名 → renames（(owner,label) 是复合键，改名=新建；须删旧条，否则留下**重复围栏**：
///   旧地址仍在，到达旧址还会播"你到家了"——web 修过的静默坑）。
enum PlaceSaveCheck: Equatable {
    case ok
    case duplicateName
    case renames(from: String)
    static func check(newLabel: String, originalLabel: String?, existing: [String]) -> PlaceSaveCheck {
        if let orig = originalLabel, orig == newLabel { return .ok }
        if existing.contains(newLabel) { return .duplicateName }
        if let orig = originalLabel { return .renames(from: orig) }
        return .ok
    }
}

struct SavedPlacesView: View {
    @Environment(AuthSession.self) private var session
    private var lang: Language { FeatureSettings().language }
    @State private var home = ""
    @State private var work = ""
    @State private var loaded = false
    @State private var status = ""
    @State private var customPlaces: [APIClient.SavedPlace] = []   // home/work 之外的自定义地点（医院/超市/女儿家…）
    @State private var newLabel = ""
    @State private var newAddress = ""
    @State private var editingOriginal: String?          // 非 nil=编辑中（原 label；改名时据此删旧防重复围栏）
    @State private var pendingOverwrite = false          // 撞名预警后等待二次确认

    var body: some View {
        Form {
            placeSection(header: SettingsStrings.homeHeader(lang),
                         placeholder: SettingsStrings.homeAddressPlaceholder(lang),
                         text: $home, saveTitle: SettingsStrings.saveHome(lang), label: "home")
            placeSection(header: SettingsStrings.workHeader(lang),
                         placeholder: SettingsStrings.workAddressPlaceholder(lang),
                         text: $work, saveTitle: SettingsStrings.saveWork(lang), label: "work")
            // 自定义地点（医院/超市/女儿家…）：语音"去医院"直达 + 到达围栏播报。服务端早支持，此前 UI 只有家/公司。
            Section(SettingsStrings.customPlacesHeader(lang)) {
                ForEach(customPlaces, id: \.label) { pl in
                    Button {
                        newLabel = pl.label; newAddress = pl.address
                        editingOriginal = pl.label; pendingOverwrite = false
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(pl.label).foregroundStyle(.primary)
                            Text(pl.address).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .accessibilityLabel("\(pl.label)，\(pl.address)，\(SettingsStrings.editPlaceHint(lang))")
                }
                .onDelete { idx in idx.map { customPlaces[$0] }.forEach { pl in delete(label: pl.label) } }
                TextField(SettingsStrings.placeLabelPlaceholder(lang), text: $newLabel)
                    .autocorrectionDisabled()
                TextField(SettingsStrings.placeAddressPlaceholder(lang), text: $newAddress)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                if pendingOverwrite {
                    Text(SettingsStrings.duplicateNameWarning(newLabel.trimmingCharacters(in: .whitespaces), lang))
                        .font(.footnote).foregroundStyle(Color.beeWarn)
                }
                HStack {
                    Button(editingOriginal != nil ? SettingsStrings.updatePlace(lang)
                           : pendingOverwrite ? SettingsStrings.confirmOverwrite(lang)
                           : SettingsStrings.addPlace(lang)) { saveCustom() }
                        .disabled(newLabel.trimmingCharacters(in: .whitespaces).isEmpty
                                  || newAddress.trimmingCharacters(in: .whitespaces).isEmpty)
                    Spacer()
                    if editingOriginal != nil || !newLabel.isEmpty || !newAddress.isEmpty {
                        Button(SettingsStrings.cancelEdit(lang)) {
                            newLabel = ""; newAddress = ""; editingOriginal = nil; pendingOverwrite = false
                        }
                    }
                }
            }
            Section { Text(SettingsStrings.savedPlacesFooter(lang)).font(.footnote).foregroundStyle(.secondary) }
            if !status.isEmpty {
                Section { Text(status).font(.footnote).foregroundStyle(.secondary)
                    .accessibilityAddTraits(.updatesFrequently) }
            }
        }
        .navigationTitle(SettingsStrings.savedPlacesTitle(lang))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        // 保存/清除结果主动朗读——盲人在设"家/公司"（喂"回家/去公司"导航），此前只把结果放进静态 Text、
        // 不朗读：**保存悄悄失败**时盲人以为设好了，日后"回家"却失败（导航攸关）。与 BlocklistView 同口径。
        .onChange(of: status) { _, s in if !s.isEmpty { A11y.announce(s) } }
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
            customPlaces = places.filter { $0.label != "home" && $0.label != "work" }
        }
    }

    /// 保存自定义地点：经 PlaceSaveCheck（已测）——撞名先警示、二次确认才覆盖；编辑改名则删旧防重复围栏。
    private func saveCustom() {
        let label = newLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        let address = newAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let token = session.token, !label.isEmpty, !address.isEmpty else { return }
        let existing = customPlaces.map(\.label) + ["home", "work"] // 与内置名撞也算撞（会覆盖家/公司围栏）
        let check = PlaceSaveCheck.check(newLabel: label, originalLabel: editingOriginal, existing: existing)
        if case .duplicateName = check, !pendingOverwrite {
            pendingOverwrite = true // 一次警示、二次确认（不静默覆盖别的围栏）
            status = SettingsStrings.duplicateNameWarning(label, lang)
            return
        }
        Task {
            do {
                try await APIClient().setSavedPlace(token: token, label: label, address: address)
                if case .renames(let from) = check {
                    try? await APIClient().deleteSavedPlace(token: token, label: from) // 删旧条，防重复围栏
                }
                await MainActor.run {
                    newLabel = ""; newAddress = ""; editingOriginal = nil; pendingOverwrite = false
                    status = SettingsStrings.placeSaved(lang)
                    loaded = false
                }
                await load()
            } catch {
                await MainActor.run { status = SettingsStrings.placeSaveFailed(lang) }
            }
        }
    }

    private func delete(label: String) {
        guard let token = session.token else { return }
        Task {
            try? await APIClient().deleteSavedPlace(token: token, label: label)
            await MainActor.run {
                customPlaces.removeAll { $0.label == label }
                status = SettingsStrings.placeCleared(lang)
            }
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
