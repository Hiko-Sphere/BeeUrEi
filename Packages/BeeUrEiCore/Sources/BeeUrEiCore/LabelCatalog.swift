import Foundation

/// 检测标签本地化（见 docs/PLAN.md §5.8）：把 COCO 英文类别映射成中文播报名，
/// 使 demo 英文模型也能中文播报，并让翻译后的名字命中 `HazardCatalog` 的高危加成。
public struct LabelCatalog: Sendable {
    public let map: [String: String]

    public init(map: [String: String] = LabelCatalog.cocoToChinese) {
        self.map = map
    }

    /// 返回中文名；未知标签回退原文（不丢信息）。大小写不敏感。
    public func localizedName(_ englishLabel: String) -> String {
        map[englishLabel.lowercased()] ?? englishLabel
    }

    /// COCO 常见 + 街景高危类别的中文映射（可扩充）。
    public static let cocoToChinese: [String: String] = [
        "person": "行人",
        "bicycle": "自行车",
        "car": "车辆",
        "motorcycle": "摩托车",
        "bus": "公交车",
        "truck": "卡车",
        "traffic light": "红绿灯",
        "fire hydrant": "消火栓",
        "stop sign": "停车标志",
        "parking meter": "停车计时器",
        "bench": "长椅",
        "dog": "狗",
        "cat": "猫",
        "backpack": "背包",
        "umbrella": "雨伞",
        "handbag": "手提包",
        "suitcase": "行李箱",
        "chair": "椅子",
        "couch": "沙发",
        "potted plant": "盆栽",
        "dining table": "桌子",
        "tv": "电视",
        "door": "门",
    ]
}
