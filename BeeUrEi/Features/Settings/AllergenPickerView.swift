import SwiftUI

/// 过敏原预警设置：勾选自己的过敏原（EU 14 大类 + 小麦）。扫码识别食品时若产品标注命中即在播报最前醒目提醒
/// （核心 AllergenAlert 比对 + FramingStrings.allergenAlertSpeak）。安全**叠加**在既有全量过敏原播报之上、不替代；
/// 缺数据的产品绝不误报"安全"。选择实时持久化到 FeatureSettings.myAllergens。
struct AllergenPickerView: View {
    let lang: Language
    @State private var selected: Set<String>

    init(lang: Language) {
        self.lang = lang
        _selected = State(initialValue: FeatureSettings().myAllergens)
    }

    var body: some View {
        Form {
            Section {
                ForEach(FramingStrings.selectableAllergens, id: \.self) { key in
                    Toggle(FramingStrings.allergenDisplay(key, lang), isOn: binding(for: key))
                }
            } header: {
                Text(SettingsStrings.allergenPickerHeader(lang))
            } footer: {
                Text(SettingsStrings.allergenPickerFooter(lang))
            }
        }
        .navigationTitle(SettingsStrings.allergenAlertTitle(lang))
    }

    /// 单个过敏原的开关绑定：切换即改本地集合并**立即持久化**（无独立保存步骤，符合设置页即时生效惯例）。
    private func binding(for key: String) -> Binding<Bool> {
        Binding(
            get: { selected.contains(key) },
            set: { on in
                if on { selected.insert(key) } else { selected.remove(key) }
                var f = FeatureSettings()
                f.myAllergens = selected
            }
        )
    }
}
