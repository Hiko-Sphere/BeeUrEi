import Foundation

/// 一条识别历史：读过的文字/整页/扫码/纸币结果。
struct RecognitionRecord: Codable, Equatable, Identifiable {
    let id: UUID
    let kind: String      // "text" / "page" / "barcode" / "banknote"
    let content: String
    let date: Date
}

/// 识别历史库（Supersense Read History/Library 式）：盲人常需要"再听一遍刚才读的内容"
/// （信件读完想复核、扫过的商品想再确认），这里把识别结果存在本机供回放。
/// 全端侧 plist、封顶条数防膨胀；内容可能含信件/票据等敏感文字——单条删除/一键清空权完全在用户，零云端。
final class RecognitionHistoryStore {
    private(set) var records: [RecognitionRecord] = []
    private let fileURL: URL
    private let maxRecords: Int

    /// fileURL/maxRecords 可注入（单测用临时目录与小上限）。
    init(fileURL: URL? = nil, maxRecords: Int = 50) {
        self.maxRecords = maxRecords
        if let fileURL {
            self.fileURL = fileURL
        } else {
            let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                ?? FileManager.default.temporaryDirectory
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            self.fileURL = dir.appendingPathComponent("recognition-history.plist")
        }
        load()
    }

    /// 新记录插到最前（最近优先）；空内容忽略；超上限丢最旧。
    func add(kind: String, content: String) {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        records.insert(RecognitionRecord(id: UUID(), kind: kind, content: trimmed, date: Date()), at: 0)
        if records.count > maxRecords { records.removeLast(records.count - maxRecords) }
        persist()
    }

    func delete(id: UUID) {
        records.removeAll { $0.id == id }
        persist()
    }

    func clear() {
        records = []
        persist()
    }

    private func persist() {
        // completeFileProtection：识别历史可能含信件/票据等敏感文字，锁屏后文件不可读（仅前台读写，无后台访问）。
        if let data = try? PropertyListEncoder().encode(records) {
            try? data.write(to: fileURL, options: [.atomic, .completeFileProtection])
        }
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL),
              let decoded = try? PropertyListDecoder().decode([RecognitionRecord].self, from: data) else { return }
        records = decoded
    }
}
