import SwiftUI

/// 食品健康提醒设置：勾选①自己的过敏原（EU 14 大类 + 小麦）②关注的营养素（糖/盐/饱和脂肪/脂肪）。扫码识别食品时
/// 若产品标注命中过敏原、或关注营养含量 high，即在播报**最前**醒目提醒（核心 AllergenAlert / NutrientAlert 比对 +
/// FramingStrings.allergenAlertSpeak / dietAlertSpeak）。安全**叠加**在既有全量播报之上、不替代；缺数据绝不误报"安全/不高"。
/// 选择实时持久化到 FeatureSettings.myAllergens / dietWatch。
struct AllergenPickerView: View {
    let lang: Language
    @State private var allergens: Set<String>
    @State private var nutrients: Set<String>

    init(lang: Language) {
        self.lang = lang
        _allergens = State(initialValue: FeatureSettings().myAllergens)
        _nutrients = State(initialValue: FeatureSettings().dietWatch)
    }

    var body: some View {
        Form {
            Section {
                ForEach(FramingStrings.selectableAllergens, id: \.self) { key in
                    Toggle(FramingStrings.allergenDisplay(key, lang), isOn: allergenBinding(for: key))
                }
            } header: {
                Text(SettingsStrings.allergenPickerHeader(lang))
            } footer: {
                Text(SettingsStrings.allergenPickerFooter(lang))
            }
            Section {
                ForEach(FramingStrings.selectableNutrients, id: \.self) { key in
                    Toggle(FramingStrings.nutrientDisplay(key, lang), isOn: nutrientBinding(for: key))
                }
            } header: {
                Text(SettingsStrings.nutrientPickerHeader(lang))
            } footer: {
                Text(SettingsStrings.nutrientPickerFooter(lang))
            }
        }
        .navigationTitle(SettingsStrings.foodHealthTitle(lang))
    }

    /// 单个过敏原开关：切换即改本地集合并**立即持久化**（无独立保存步骤，符合设置页即时生效惯例）。
    private func allergenBinding(for key: String) -> Binding<Bool> {
        Binding(
            get: { allergens.contains(key) },
            set: { on in
                if on { allergens.insert(key) } else { allergens.remove(key) }
                var f = FeatureSettings()
                f.myAllergens = allergens
            }
        )
    }

    /// 单个关注营养素开关：同样即时持久化到 FeatureSettings.dietWatch。
    private func nutrientBinding(for key: String) -> Binding<Bool> {
        Binding(
            get: { nutrients.contains(key) },
            set: { on in
                if on { nutrients.insert(key) } else { nutrients.remove(key) }
                var f = FeatureSettings()
                f.dietWatch = nutrients
            }
        )
    }
}
