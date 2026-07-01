import Foundation

/// 高危「绝不能漏」类别清单（见 docs/PLAN.md §5.8）。
/// 这些恰是精简检测类别时容易被裁掉、却对盲人最危险的静态障碍。
public struct HazardCatalog: Sendable {
    public let highRiskLabels: Set<String>

    public init(highRiskLabels: Set<String> = HazardCatalog.defaultHighRisk) {
        self.highRiskLabels = highRiskLabels
    }

    /// 按语言选高危标签集（需与 LabelCatalog 同语言，才能命中本地化名做加成）。
    public init(language: Language) {
        switch language {
        case .zh: self.init(highRiskLabels: HazardCatalog.defaultHighRisk)
        case .en: self.init(highRiskLabels: HazardCatalog.defaultHighRiskEnglish)
        }
    }

    public static let defaultHighRisk: Set<String> = [
        // "障碍物" 必须与 LabelCatalog 中文未知回退名一致——否则**未识别障碍**(自训类别/裁剪掉的类)
        // 命不中高危加成，而英文侧("obstacle")却命中，造成中文用户漏掉"不认识但挡路"的危险。保留旧
        // "障碍"以防自训模型直出该词。
        "台阶", "路桩", "玻璃门", "消火栓", "护栏", "坑洞", "障碍", "障碍物",
        "车辆", "自行车", "电动车", "摩托车", "公交车", "卡车", "栏杆", "井盖",
    ]

    /// 英文高危集（与 cocoToEnglish 本地化名对齐）。
    public static let defaultHighRiskEnglish: Set<String> = [
        "stairs", "pole", "door", "fire hydrant", "obstacle", "curb",
        "vehicle", "bicycle", "motorcycle", "bus", "truck",
    ]

    public func isHighRisk(_ label: String) -> Bool {
        highRiskLabels.contains(label)
    }
}
