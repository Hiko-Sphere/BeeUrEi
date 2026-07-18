import SwiftUI

/// 本人紧急医疗信息填写（血型/过敏/用药/慢性病/紧急备注）：供本人指定的**已接受紧急联系人**在遇险时查看、辅助施救。
/// 服务端 AES-256-GCM 加密落库，绝不公开、绝不进推送内容。与网页端 Account 的 MedicalInfoCard、服务端
/// /api/account/medical 同链。此前 iOS 只有"施救者查看"、缺"本人填写"——iOS 主用户(盲人)无从录入自己的医疗信息，
/// 施救查看便无数据可看（本屏补齐 FILL 侧，闭合医疗安全环）。

enum MedicalInfoStrings {
    static func navTitle(_ l: Language) -> String { l == .zh ? "紧急医疗信息" : "Emergency medical info" }
    static func explain(_ l: Language) -> String {
        l == .zh ? "血型、过敏、正在服用的药物、慢性病、紧急备注等。仅你已接受的紧急联系人在你遇险时可查看，用于辅助施救；加密存储，不会公开或进入推送内容。"
                 : "Blood type, allergies, medications, conditions, emergency notes. Visible only to your accepted emergency contacts when you need help — to assist responders. Encrypted at rest; never public or in push notifications."
    }
    static func placeholder(_ l: Language) -> String {
        l == .zh ? "例：A 型血；青霉素过敏；服用华法林；家庭医生 138…" : "e.g. Type A; penicillin allergy; on warfarin; GP 555…"
    }
    static func fieldLabel(_ l: Language) -> String { l == .zh ? "医疗信息" : "Medical info" }
    static func save(_ l: Language) -> String { l == .zh ? "保存" : "Save" }
    static func saved(_ l: Language) -> String { l == .zh ? "已保存" : "Saved" }
    static func cleared(_ l: Language) -> String { l == .zh ? "已清除" : "Cleared" }
    static func saveFailed(_ l: Language) -> String { l == .zh ? "保存失败，请重试" : "Couldn't save — try again" }
    static func loadFailed(_ l: Language) -> String { l == .zh ? "加载失败（需登录并连接后端）" : "Couldn't load (sign in and connect to the backend)" }
    static func charCount(_ n: Int, _ l: Language) -> String { "\(n)/4000" }
    /// 上次更新时刻（提醒本人别让医疗信息过期）。
    static func lastUpdated(_ when: String, _ l: Language) -> String { l == .zh ? "上次更新：\(when)" : "Last updated: \(when)" }
    /// 医疗信息**陈旧提醒**：距上次更新超过约 1 年 → 提示复核。用药、过敏、慢性病会变，陈旧信息会误导施救者
    /// （如已停的药、新增的过敏）——只显 lastUpdated 时间戳、盲人无从判断"这算不算旧了"，故据阈值给出可行动提醒。
    /// updatedAtMs/nowMs 均为**毫秒**（服务端 Date.now() 口径）。纯逻辑、now 可注入、可单测；未达阈值/非有限 → nil。
    static func stalenessWarning(updatedAtMs: Double, nowMs: Double, _ l: Language) -> String? {
        let days = (nowMs - updatedAtMs) / 86_400_000
        guard days.isFinite, days >= 365 else { return nil }
        let months = max(12, Int(days / 30))
        return l == .zh ? "医疗信息已约\(months)个月没更新了——用药或病史可能已变，建议复核一下，免得施救者拿到过时信息。"
                        : "Your medical info hasn't been updated in about \(months) months — meds or conditions may have changed. Please review it so responders don't act on outdated info."
    }
}

struct MedicalInfoView: View {
    let token: String
    private static let maxChars = 4000 // 与服务端 putSchema.max(4000) 一致
    @State private var text = ""
    @State private var loading = true
    @State private var loadFailed = false
    @State private var saving = false
    @State private var statusText: String?
    @State private var updatedAt: Double? // 服务端记录的上次更新时刻——提示本人别让医疗信息过期（用药/病史会变）
    private let api = APIClient()
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        Form {
            if loading {
                Section { HStack { Spacer(); ProgressView(); Spacer() } }
            } else if loadFailed {
                Section { Text(MedicalInfoStrings.loadFailed(lang)).foregroundStyle(.secondary) }
            } else {
                Section {
                    // TextField(axis:.vertical) 多行可增高，VoiceOver 可读写、支持听写录入。
                    TextField(MedicalInfoStrings.placeholder(lang), text: $text, axis: .vertical)
                        .lineLimit(4...10)
                        .accessibilityLabel(MedicalInfoStrings.fieldLabel(lang))
                        .onChange(of: text) { _, new in
                            if new.count > Self.maxChars { text = String(new.prefix(Self.maxChars)) } // 本地夹到上限，免服务端 400
                        }
                    // 上次更新时刻（本人提醒）：医疗信息会随用药/病史变化，据此判断是否该复核更新（服务端下发
                    // updatedAt 此前在填写页丢弃=死字段；与施救者查看侧显示"更新于X"对称）。仅有已保存内容时显示。
                    if let updatedAt, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text(MedicalInfoStrings.lastUpdated(RecordingStrings.timeText(updatedAt, lang), lang))
                            .font(.caption).foregroundStyle(.secondary)
                        // 陈旧提醒（约 1 年未更新）：黄色（非危急红）的可行动提示——用药/病史会变，别让施救者拿到过时信息。
                        if let warn = MedicalInfoStrings.stalenessWarning(updatedAtMs: updatedAt, nowMs: Date().timeIntervalSince1970 * 1000, lang) {
                            Text(warn).font(.caption).foregroundStyle(Color.beeWarn).accessibilityLabel(warn)
                        }
                    }
                } footer: {
                    Text(MedicalInfoStrings.explain(lang))
                }
                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            Text(MedicalInfoStrings.save(lang))
                            Spacer()
                            Text(MedicalInfoStrings.charCount(text.count, lang)).font(.caption).foregroundStyle(.secondary)
                            if saving { ProgressView() }
                        }
                    }
                    .disabled(saving)
                    if let statusText {
                        Text(statusText).font(.footnote).foregroundStyle(.secondary)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                }
            }
        }
        .navigationTitle(MedicalInfoStrings.navTitle(lang))
        .task { await load() }
    }

    private func load() async {
        loading = true; loadFailed = false
        do {
            let info = try await api.myMedicalInfo(token: token)
            text = info.medicalInfo
            updatedAt = info.updatedAt
        } catch {
            loadFailed = true
        }
        loading = false
    }

    private func save() async {
        saving = true; statusText = nil
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await api.setMyMedicalInfo(token: token, text: text)
            updatedAt = trimmed.isEmpty ? nil : Date().timeIntervalSince1970 * 1000 // 保存即"现在更新"；清空则无记录
            let msg = trimmed.isEmpty ? MedicalInfoStrings.cleared(lang) : MedicalInfoStrings.saved(lang)
            statusText = msg
            A11y.announce(msg) // 盲人：保存结果语音确认
        } catch {
            statusText = MedicalInfoStrings.saveFailed(lang)
            A11y.announce(MedicalInfoStrings.saveFailed(lang))
        }
        saving = false
    }
}
