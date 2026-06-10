import Foundation

/// 过街辅助（见 PLAN §14 Q7）：检测到「红绿灯」时给出过街提示。
/// 注：可靠的红/绿**颜色**判别需专用模型（类 OKO，属外部资产，见 §13.3）；
/// 此处先做"存在性"提示——基于检测器已识别的红绿灯类别。
public struct CrossingAssistant: Sendable {
    public let trafficLightLabel: String

    public init(trafficLightLabel: String = "红绿灯") {
        self.trafficLightLabel = trafficLightLabel
    }

    /// 按语言选红绿灯的本地化检测名（需与 LabelCatalog 同语言，才能命中 obstacles 里的名字）。
    public init(language: Language) {
        switch language {
        case .zh: self.init(trafficLightLabel: "红绿灯")
        case .en: self.init(trafficLightLabel: "traffic light")
        }
    }

    public func hint(forLabels labels: [String], language: Language = .zh) -> String? {
        labels.contains(trafficLightLabel) ? SpokenStrings.crossingHasLight(language) : nil
    }
}
