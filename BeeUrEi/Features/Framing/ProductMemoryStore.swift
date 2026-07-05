import Foundation

/// 「扫码认商品」本地商品库：条码 → 用户起的名字（plist 存盘，全端侧、零云端）。
/// Seeing AI 的商品频道靠云端数据库报商品名；这里改为"扫一次自己命名，以后离线秒报"——隐私优先，
/// 且认的是用户自己的常用商品（药盒/调料/饮料），比通用库更贴身。
final class ProductMemoryStore {
    private var items: [String: String] = [:] // 条码 → 名字
    private var allergenItems: [String: [String]] = [:] // 条码 → 包装标注过敏原（OFF 规范词，在线查到时随名字一起存）
    private var tracesItems: [String: [String]] = [:] // 条码 → 微量/交叉污染标注（OFF traces_tags 规范词；"可能含微量"）
    private var nutriItems: [String: String] = [:] // 条码 → Nutri-Score（a..e，在线查到时随名字存，供离线复扫也能报营养质量）
    private var novaItems: [String: Int] = [:]     // 条码 → NOVA 加工程度（1..4）
    private var dietaryItems: [String: [String]] = [:] // 条码 → 膳食/宗教认证标注（OFF labels_tags 子集：gluten-free/vegan/halal…）
    private var quantityItems: [String: String] = [:]  // 条码 → 净含量/规格文本（"500 ml"/"200 g"）
    private let fileURL: URL
    private let allergensURL: URL // 独立旁路文件：老版本的名字 plist 原样不动（零迁移风险），缺文件=全空
    private let tracesURL: URL    // 同款独立旁路文件（缺文件=全空，零迁移风险）
    private let nutriURL: URL     // 同款独立旁路文件（缺文件=全空，零迁移风险）
    private let novaURL: URL      // 同款独立旁路文件（缺文件=全空，零迁移风险）
    private let dietaryURL: URL   // 同款独立旁路文件（缺文件=全空，零迁移风险）
    private let quantityURL: URL  // 同款独立旁路文件（缺文件=全空，零迁移风险）

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
        self.allergensURL = self.fileURL.deletingPathExtension().appendingPathExtension("allergens.plist")
        self.tracesURL = self.fileURL.deletingPathExtension().appendingPathExtension("traces.plist")
        self.nutriURL = self.fileURL.deletingPathExtension().appendingPathExtension("nutri.plist")
        self.novaURL = self.fileURL.deletingPathExtension().appendingPathExtension("nova.plist")
        self.dietaryURL = self.fileURL.deletingPathExtension().appendingPathExtension("dietary.plist")
        self.quantityURL = self.fileURL.deletingPathExtension().appendingPathExtension("quantity.plist")
        load()
    }

    var count: Int { items.count }

    func name(for barcode: String) -> String? { items[barcode] }

    /// 包装标注过敏原（在线查到时存下的）。空=无数据——**缺数据≠不含**，上层只在非空时播"标注含有"。
    func allergens(for barcode: String) -> [String] { allergenItems[barcode] ?? [] }

    /// 微量/交叉污染标注（在线查到时存下的）。空=无数据——**缺数据≠不含**，上层只在非空时播"可能含微量"。
    func traces(for barcode: String) -> [String] { tracesItems[barcode] ?? [] }

    /// Nutri-Score（a..e）/ NOVA 加工程度（1..4）：在线查到时存下的营养质量。nil=无数据（不猜、不硬凑）。
    func nutriScore(for barcode: String) -> String? { nutriItems[barcode] }
    func novaGroup(for barcode: String) -> Int? { novaItems[barcode] }

    /// 膳食/宗教认证标注（无麸质/纯素/清真…的 canonical key，在线查到时存下的）。空=无数据——**缺数据≠不符/不含**。
    func dietaryLabels(for barcode: String) -> [String] { dietaryItems[barcode] ?? [] }

    /// 净含量/规格文本（"500 ml"/"200 g"，在线查到时存下的）。nil=无数据（不猜）。
    func quantity(for barcode: String) -> String? { quantityItems[barcode] }

    /// allergens/traces/营养/膳食标注/净含量 只在**有数据**时覆盖——用户手动改名（save(barcode:name:) 默认空）不得抹掉已存的标注。
    func save(barcode: String, name: String, allergens: [String] = [], traces: [String] = [],
              nutriScore: String? = nil, novaGroup: Int? = nil, dietaryLabels: [String] = [], quantity: String? = nil) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !barcode.isEmpty else { return }
        items[barcode] = trimmed
        if !allergens.isEmpty { allergenItems[barcode] = allergens }
        if !traces.isEmpty { tracesItems[barcode] = traces }
        if let nutriScore, !nutriScore.isEmpty { nutriItems[barcode] = nutriScore }
        if let novaGroup { novaItems[barcode] = novaGroup }
        if !dietaryLabels.isEmpty { dietaryItems[barcode] = dietaryLabels }
        if let quantity, !quantity.isEmpty { quantityItems[barcode] = quantity }
        persist()
    }

    func delete(barcode: String) {
        items.removeValue(forKey: barcode)
        allergenItems.removeValue(forKey: barcode)
        tracesItems.removeValue(forKey: barcode)
        nutriItems.removeValue(forKey: barcode)
        novaItems.removeValue(forKey: barcode)
        dietaryItems.removeValue(forKey: barcode)
        quantityItems.removeValue(forKey: barcode)
        persist()
    }

    private func persist() {
        // completeFileProtection：商品库反映用户的药品/饮食习惯，锁屏后文件不可读（仅前台读写）。
        if let data = try? PropertyListEncoder().encode(items) {
            try? data.write(to: fileURL, options: [.atomic, .completeFileProtection])
        }
        if let data = try? PropertyListEncoder().encode(allergenItems) {
            try? data.write(to: allergensURL, options: [.atomic, .completeFileProtection])
        }
        if let data = try? PropertyListEncoder().encode(tracesItems) {
            try? data.write(to: tracesURL, options: [.atomic, .completeFileProtection])
        }
        if let data = try? PropertyListEncoder().encode(nutriItems) {
            try? data.write(to: nutriURL, options: [.atomic, .completeFileProtection])
        }
        if let data = try? PropertyListEncoder().encode(novaItems) {
            try? data.write(to: novaURL, options: [.atomic, .completeFileProtection])
        }
        if let data = try? PropertyListEncoder().encode(dietaryItems) {
            try? data.write(to: dietaryURL, options: [.atomic, .completeFileProtection])
        }
        if let data = try? PropertyListEncoder().encode(quantityItems) {
            try? data.write(to: quantityURL, options: [.atomic, .completeFileProtection])
        }
    }

    private func load() {
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? PropertyListDecoder().decode([String: String].self, from: data) {
            items = decoded
        }
        if let data = try? Data(contentsOf: allergensURL),
           let decoded = try? PropertyListDecoder().decode([String: [String]].self, from: data) {
            allergenItems = decoded
        }
        if let data = try? Data(contentsOf: tracesURL),
           let decoded = try? PropertyListDecoder().decode([String: [String]].self, from: data) {
            tracesItems = decoded
        }
        if let data = try? Data(contentsOf: nutriURL),
           let decoded = try? PropertyListDecoder().decode([String: String].self, from: data) {
            nutriItems = decoded
        }
        if let data = try? Data(contentsOf: novaURL),
           let decoded = try? PropertyListDecoder().decode([String: Int].self, from: data) {
            novaItems = decoded
        }
        if let data = try? Data(contentsOf: dietaryURL),
           let decoded = try? PropertyListDecoder().decode([String: [String]].self, from: data) {
            dietaryItems = decoded
        }
        if let data = try? Data(contentsOf: quantityURL),
           let decoded = try? PropertyListDecoder().decode([String: String].self, from: data) {
            quantityItems = decoded
        }
    }
}
