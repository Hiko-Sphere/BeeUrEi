import SwiftUI

/// 国家/地区区号（精选常用，覆盖主要地区；含旗帜与拨号码）。
struct CountryCode: Identifiable, Hashable {
    let id: String          // 区域标识，如 "CN"
    let dial: String        // 拨号码，如 "+86"
    let flag: String        // 旗帜 emoji
    let nameZh: String
    let nameEn: String
    func name(_ l: Language) -> String { l == .zh ? nameZh : nameEn }
}

enum CountryCodes {
    static let all: [CountryCode] = [
        .init(id: "CN", dial: "+86", flag: "🇨🇳", nameZh: "中国大陆", nameEn: "China"),
        .init(id: "HK", dial: "+852", flag: "🇭🇰", nameZh: "中国香港", nameEn: "Hong Kong"),
        .init(id: "MO", dial: "+853", flag: "🇲🇴", nameZh: "中国澳门", nameEn: "Macau"),
        .init(id: "TW", dial: "+886", flag: "🇹🇼", nameZh: "中国台湾", nameEn: "Taiwan"),
        .init(id: "US", dial: "+1", flag: "🇺🇸", nameZh: "美国 / 加拿大", nameEn: "USA / Canada"),
        .init(id: "GB", dial: "+44", flag: "🇬🇧", nameZh: "英国", nameEn: "United Kingdom"),
        .init(id: "JP", dial: "+81", flag: "🇯🇵", nameZh: "日本", nameEn: "Japan"),
        .init(id: "KR", dial: "+82", flag: "🇰🇷", nameZh: "韩国", nameEn: "South Korea"),
        .init(id: "SG", dial: "+65", flag: "🇸🇬", nameZh: "新加坡", nameEn: "Singapore"),
        .init(id: "MY", dial: "+60", flag: "🇲🇾", nameZh: "马来西亚", nameEn: "Malaysia"),
        .init(id: "AU", dial: "+61", flag: "🇦🇺", nameZh: "澳大利亚", nameEn: "Australia"),
        .init(id: "DE", dial: "+49", flag: "🇩🇪", nameZh: "德国", nameEn: "Germany"),
        .init(id: "FR", dial: "+33", flag: "🇫🇷", nameZh: "法国", nameEn: "France"),
        .init(id: "IT", dial: "+39", flag: "🇮🇹", nameZh: "意大利", nameEn: "Italy"),
        .init(id: "ES", dial: "+34", flag: "🇪🇸", nameZh: "西班牙", nameEn: "Spain"),
        .init(id: "NL", dial: "+31", flag: "🇳🇱", nameZh: "荷兰", nameEn: "Netherlands"),
        .init(id: "IN", dial: "+91", flag: "🇮🇳", nameZh: "印度", nameEn: "India"),
        .init(id: "ID", dial: "+62", flag: "🇮🇩", nameZh: "印度尼西亚", nameEn: "Indonesia"),
        .init(id: "TH", dial: "+66", flag: "🇹🇭", nameZh: "泰国", nameEn: "Thailand"),
        .init(id: "VN", dial: "+84", flag: "🇻🇳", nameZh: "越南", nameEn: "Vietnam"),
        .init(id: "PH", dial: "+63", flag: "🇵🇭", nameZh: "菲律宾", nameEn: "Philippines"),
        .init(id: "NZ", dial: "+64", flag: "🇳🇿", nameZh: "新西兰", nameEn: "New Zealand"),
        .init(id: "CA", dial: "+1", flag: "🇨🇦", nameZh: "加拿大", nameEn: "Canada"),
        .init(id: "RU", dial: "+7", flag: "🇷🇺", nameZh: "俄罗斯", nameEn: "Russia"),
        .init(id: "BR", dial: "+55", flag: "🇧🇷", nameZh: "巴西", nameEn: "Brazil"),
        .init(id: "AE", dial: "+971", flag: "🇦🇪", nameZh: "阿联酋", nameEn: "UAE"),
    ]
    /// 按系统区域推断默认区号（找不到回退中国大陆）。
    static var deviceDefault: CountryCode {
        let region = Locale.current.region?.identifier
        return all.first { $0.id == region } ?? all[0]
    }
    /// 从一个完整号码（可能带 +区号）解析出 (区号, 本地号)；无法识别则返回默认区号 + 原串数字。
    static func split(_ full: String) -> (country: CountryCode, local: String) {
        let digits = full.filter { $0.isNumber || $0 == "+" }
        if digits.hasPrefix("+") {
            // 最长前缀匹配区号。
            let match = all.filter { digits.hasPrefix($0.dial) }.max { $0.dial.count < $1.dial.count }
            if let m = match { return (m, String(digits.dropFirst(m.dial.count))) }
        }
        return (deviceDefault, digits.replacingOccurrences(of: "+", with: ""))
    }
}

/// 绑定/更换手机号：区号选择 + 号码输入（区号可选，行业标准）。完成回传完整 E.164 号码（+区号号码）。
struct PhoneBindSheet: View {
    let title: String
    var initialPhone: String = ""
    let onSave: (String) -> Void           // 传回完整号码（如 "+8613800138000"）
    @Environment(\.dismiss) private var dismiss
    @State private var country: CountryCode
    @State private var local: String
    private var lang: Language { FeatureSettings().language }

    init(title: String, initialPhone: String = "", onSave: @escaping (String) -> Void) {
        self.title = title
        self.initialPhone = initialPhone
        self.onSave = onSave
        let parsed = CountryCodes.split(initialPhone)
        _country = State(initialValue: parsed.country)
        _local = State(initialValue: parsed.local)
    }

    private var fullPhone: String { country.dial + local.filter(\.isNumber) }
    private var valid: Bool { local.filter(\.isNumber).count >= 5 }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(AccountStrings.countryCode(lang), selection: $country) {
                        ForEach(CountryCodes.all) { c in
                            Text("\(c.flag) \(c.name(lang)) \(c.dial)").tag(c)
                        }
                    }
                    .accessibilityLabel(AccountStrings.countryCode(lang))
                    HStack(spacing: 8) {
                        Text(country.dial).foregroundStyle(.secondary).accessibilityHidden(true)
                        TextField(AccountStrings.phonePlaceholder(lang), text: $local)
                            .keyboardType(.phonePad)
                            .textContentType(.telephoneNumber)
                            .accessibilityLabel(AccountStrings.phonePlaceholder(lang))
                    }
                } footer: {
                    Text(AccountStrings.phoneSheetFooter(lang))
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(AccountStrings.cancel(lang)) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(AccountStrings.save(lang)) { onSave(fullPhone); dismiss() }.disabled(!valid)
                }
            }
        }
    }
}
