import SwiftUI

/// 法律文件类型（隐私 / 条款 / EULA / 安全须知）。
enum LegalDocument: String, CaseIterable, Identifiable {
    case privacy, terms, eula, safety
    var id: String { rawValue }

    func title(_ l: Language) -> String {
        switch self {
        case .privacy: return l == .zh ? "隐私政策" : "Privacy Policy"
        case .terms: return l == .zh ? "使用条款" : "Terms of Service"
        case .eula: return l == .zh ? "最终用户许可协议" : "End-User License (EULA)"
        case .safety: return l == .zh ? "安全须知" : "Safety Notice"
        }
    }
    var systemImage: String {
        switch self {
        case .privacy: return "lock.shield"
        case .terms: return "doc.text"
        case .eula: return "checkmark.seal"
        case .safety: return "exclamationmark.triangle"
        }
    }
    func body(_ l: Language) -> String {
        switch self {
        case .privacy: return LegalText.privacyPolicy(l)
        case .terms: return LegalText.termsOfService(l)
        case .eula: return LegalText.eula(l)
        case .safety: return DisclaimerText.full(l)
        }
    }
}

enum LegalStrings {
    static func legalCenter(_ l: Language) -> String { l == .zh ? "法律与隐私" : "Legal & Privacy" }
    static func versionLine(_ l: Language) -> String {
        l == .zh ? "版本 \(LegalText.version) · 生效日期 \(LegalText.effectiveDate)"
                 : "Version \(LegalText.version) · Effective \(LegalText.effectiveDate)"
    }
    static func agreePrefix(_ l: Language) -> String { l == .zh ? "继续即表示你已阅读并同意" : "By continuing you agree to the" }
    static func and(_ l: Language) -> String { l == .zh ? "与" : "and" }
}

/// 单篇法律文件阅读页：可滚动、VoiceOver 完整可读、可复制。
struct LegalDocumentView: View {
    let document: LegalDocument
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        ScrollView {
            Text(document.body(lang))
                .font(.body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .accessibilityLabel(document.body(lang))
        }
        .navigationTitle(document.title(lang))
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// 法律中心：隐私 / 条款 / EULA / 安全须知 + 版本说明。设置页与引导页共用。
struct LegalCenterView: View {
    private var lang: Language { FeatureSettings().language }
    var body: some View {
        List {
            Section {
                ForEach(LegalDocument.allCases) { doc in
                    NavigationLink {
                        LegalDocumentView(document: doc)
                    } label: {
                        Label(doc.title(lang), systemImage: doc.systemImage)
                    }
                }
            } footer: {
                Text(LegalStrings.versionLine(lang))
            }
        }
        .navigationTitle(LegalStrings.legalCenter(lang))
    }
}
