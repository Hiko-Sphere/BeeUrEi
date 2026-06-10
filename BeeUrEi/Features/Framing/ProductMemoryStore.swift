import Foundation

/// 「扫码认商品」本地商品库：条码 → 用户起的名字（plist 存盘，全端侧、零云端）。
/// Seeing AI 的商品频道靠云端数据库报商品名；这里改为"扫一次自己命名，以后离线秒报"——隐私优先，
/// 且认的是用户自己的常用商品（药盒/调料/饮料），比通用库更贴身。
final class ProductMemoryStore {
    private var items: [String: String] = [:] // 条码 → 名字
    private let fileURL: URL

    /// fileURL 可注入（单测用临时目录）；默认存 Application Support。
    init(fileURL: URL? = nil) {
        if let fileURL {
            self.fileURL = fileURL
        } else {
            let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                ?? FileManager.default.temporaryDirectory
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            self.fileURL = dir.appendingPathComponent("product-memory.plist")
        }
        load()
    }

    var count: Int { items.count }

    func name(for barcode: String) -> String? { items[barcode] }

    func save(barcode: String, name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !barcode.isEmpty else { return }
        items[barcode] = trimmed
        persist()
    }

    func delete(barcode: String) {
        items.removeValue(forKey: barcode)
        persist()
    }

    private func persist() {
        // completeFileProtection：商品库反映用户的药品/饮食习惯，锁屏后文件不可读（仅前台读写）。
        if let data = try? PropertyListEncoder().encode(items) {
            try? data.write(to: fileURL, options: [.atomic, .completeFileProtection])
        }
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL),
              let decoded = try? PropertyListDecoder().decode([String: String].self, from: data) else { return }
        items = decoded
    }
}
