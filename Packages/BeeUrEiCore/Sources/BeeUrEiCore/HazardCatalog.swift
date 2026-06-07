import Foundation

/// 高危「绝不能漏」类别清单（见 docs/PLAN.md §5.8）。
/// 这些恰是精简检测类别时容易被裁掉、却对盲人最危险的静态障碍。
public struct HazardCatalog: Sendable {
    public let highRiskLabels: Set<String>

    public init(highRiskLabels: Set<String> = HazardCatalog.defaultHighRisk) {
        self.highRiskLabels = highRiskLabels
    }

    public static let defaultHighRisk: Set<String> = [
        "台阶", "路桩", "玻璃门", "消火栓", "护栏", "坑洞", "障碍",
        "车辆", "自行车", "电动车", "摩托车", "公交车", "卡车", "栏杆", "井盖",
    ]

    public func isHighRisk(_ label: String) -> Bool {
        highRiskLabels.contains(label)
    }
}
