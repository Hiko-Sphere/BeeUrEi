import Foundation
import Vision

/// 「找我的东西」已学物品库：名称 → 多角度 FeaturePrint（归档存盘，全端侧、零云端）。
/// 通用识别器只认"椅子"认不出"我的钥匙"——这里用 Vision 特征指纹做个性化近似匹配。
final class TaughtItemsStore {
    private var items: [String: [Data]] = [:] // 名称 → 归档的 VNFeaturePrintObservation
    private let fileURL: URL

    init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("taught-items.plist")
        load()
    }

    var names: [String] { items.keys.sorted() }

    func save(name: String, prints: [VNFeaturePrintObservation]) {
        let archived = prints.compactMap { try? NSKeyedArchiver.archivedData(withRootObject: $0, requiringSecureCoding: true) }
        guard !archived.isEmpty else { return }
        items[name] = archived
        persist()
    }

    func prints(for name: String) -> [VNFeaturePrintObservation] {
        (items[name] ?? []).compactMap {
            try? NSKeyedUnarchiver.unarchivedObject(ofClass: VNFeaturePrintObservation.self, from: $0)
        }
    }

    func delete(name: String) {
        items.removeValue(forKey: name)
        persist()
    }

    private func persist() {
        // completeFileProtection：个人物品特征指纹属用户隐私数据，锁屏后文件不可读（仅前台读写）。
        if let data = try? PropertyListEncoder().encode(items) {
            try? data.write(to: fileURL, options: [.atomic, .completeFileProtection])
        }
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL),
              let decoded = try? PropertyListDecoder().decode([String: [Data]].self, from: data) else { return }
        items = decoded
    }
}
