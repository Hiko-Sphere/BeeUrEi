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
        // 关键：本集必须命中 LabelCatalog **中文输出名**，否则该危险在中文侧漏掉高危加成、而英文侧却命中。
        // 已对齐英文高危集：门(door)/路沿(curb)/障碍物(unknown 回退) 均需在此——原先只有 玻璃门/障碍(少字)、
        // 且缺 路沿，导致中文用户对检测到的门/路沿/未识别障碍都拿不到高危提醒。保留 玻璃门/障碍 以防自训直出。
        // 长椅/停车计时器：与已收录的 消火栓/路桩 同类——人行道上齐腰高的实体固定物，盲人正面撞上是真实伤害，
        // 属"绝不能漏的静态障碍"（COCO bench/parking meter 本就会被检出、命名，此前唯独漏了高危加成，与 hydrant 不一致）。
        // 椅子/盆栽：同一判据——沿街咖啡座椅、店门口花箱/盆栽是最常见的人行道齐腰高固定障碍，盲人正面撞上真实伤害；
        // COCO chair/potted plant 本就检出命名（localizedName 产出"椅子"/"盆栽"），此前唯独漏高危加成，与 bench 不一致。
        "台阶", "路桩", "门", "玻璃门", "消火栓", "路沿", "护栏", "坑洞", "障碍", "障碍物",
        "车辆", "自行车", "电动车", "摩托车", "公交车", "卡车", "栏杆", "井盖", "长椅", "停车计时器",
        "椅子", "盆栽",
    ]

    /// 英文高危集（与 cocoToEnglish 本地化名对齐）。
    public static let defaultHighRiskEnglish: Set<String> = [
        "stairs", "pole", "door", "fire hydrant", "obstacle", "curb",
        "vehicle", "bicycle", "motorcycle", "bus", "truck", "bench", "parking meter",
        "chair", "potted plant", // 沿街座椅/花箱：与 bench 同类的人行道齐腰高固定障碍（zh 椅子/盆栽 对齐）
    ]

    public func isHighRisk(_ label: String) -> Bool {
        highRiskLabels.contains(label)
    }
}
