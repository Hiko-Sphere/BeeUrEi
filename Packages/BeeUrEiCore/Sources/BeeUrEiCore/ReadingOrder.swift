import Foundation

/// OCR 文本块按**阅读顺序**重排（纯逻辑，可单测）。Apple Vision 的文本观测**不保证**按阅读顺序返回
/// （常按置信度/检测序），直接拼接朗读会让盲人听到错乱的文本。本模块把文本块按「从上到下、行内从左到右」
/// 重排——对标 Seeing AI「文档」频道的朗读顺序，是"读整段文字"功能的排序底座。
///
/// 坐标约定：归一化 [0,1]，**y 向下**（顶部 y 小、越往下越大），x 向右。Apple Vision 的 boundingBox 是
/// **左下原点**（y 向上），App 适配层须翻转喂入：`y = 1 - box.maxY`、`x = box.minX`、`height = box.height`。
///
/// 范围：面向**单栏**文本（标签/菜单/信件/告示/说明书——盲人日常最常扫的版式）。多栏报纸式版面的跨栏
/// 阅读顺序（先读完左栏再读右栏）不在本模块范围（会退化为按视觉行左右交错），如需再引入列聚类。
public enum ReadingOrder {
    /// 一个 OCR 文本块（通常是 Vision 的一行观测）。
    public struct Block: Sendable, Equatable {
        public let text: String
        public let x: Double       // 左边缘（归一化，越大越靠右）——行内左→右排序用
        public let y: Double       // 顶边缘（归一化，y 向下：越小越靠上）
        public let height: Double  // 高度（归一化）——同一行判定的尺度
        public init(text: String, x: Double, y: Double, height: Double) {
            self.text = text; self.x = x; self.y = y; self.height = height
        }
        var centerY: Double { y + height / 2 }
        /// 有效块：文本非空白、坐标有限、高度为正（坏观测一律剔除，与全库 isFinite 守卫一致）。
        var isValid: Bool {
            !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && x.isFinite && y.isFinite && height.isFinite && height > 0
        }
    }

    /// 按阅读顺序返回**行**：每行 = 该视觉行内从左到右的块以单空格连接；行序从上到下。无有效块返回 []。
    public static func lines(_ blocks: [Block]) -> [String] {
        let valid = blocks.filter { $0.isValid }
        guard !valid.isEmpty else { return [] }
        // 按行中心 y 升序（顶部在前）。已排序 → 贪心分行成立：一旦越出当前行的纵向带，后续块也必然越出。
        let sorted = valid.sorted { $0.centerY < $1.centerY }
        var rows: [[Block]] = []
        for b in sorted {
            // 同一视觉行：块中心 y 与当前行代表中心 y 之差 < 0.6×行高（相邻文本行的中心相距约 1 个行高，
            // 0.6 阈值把"同行并排"（差≈0）与"上下两行"（差≈1 行高）稳妥分开）。
            if let last = rows.last, let ref = last.first,
               abs(b.centerY - Self.rowCenterY(last)) < 0.6 * Swift.max(b.height, ref.height) {
                rows[rows.count - 1].append(b)
            } else {
                rows.append([b])
            }
        }
        return rows.map { row in row.sorted { $0.x < $1.x }.map(\.text).joined(separator: " ") }
    }

    /// 便捷：整段文本（行间以换行连接），供一次性朗读/展示。
    public static func text(_ blocks: [Block]) -> String {
        lines(blocks).joined(separator: "\n")
    }

    private static func rowCenterY(_ row: [Block]) -> Double {
        row.map(\.centerY).reduce(0, +) / Double(row.count)
    }
}
