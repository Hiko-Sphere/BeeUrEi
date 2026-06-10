import Foundation

/// 场景概述（纯逻辑，可单测）："前方有什么"——把检测到的物体按左/中/右分区、计数、汇总成一句话。
/// 盲人最常问的"前面是什么"。位置用检测框中心横坐标 0...1（左<0.4，右>0.6，其余中间）。
public struct SceneSummarizer: Sendable {
    public init() {}

    public func summary(objects: [(label: String, normalizedX: Double)], language: Language = .zh) -> String {
        guard !objects.isEmpty else { return SpokenStrings.sceneEmpty(language) }
        func zone(_ x: Double) -> Int { x < 0.4 ? 0 : (x > 0.6 ? 2 : 1) }

        var parts: [String] = []
        for z in [1, 0, 2] { // 先中间，再左、右
            let labels = objects.filter { zone($0.normalizedX) == z }.map { $0.label }
            guard !labels.isEmpty else { continue }
            // 计数 + 按首次出现稳定排序（保证确定性、可测）。
            var order: [String] = []
            var counts: [String: Int] = [:]
            for l in labels {
                if counts[l] == nil { order.append(l) }
                counts[l, default: 0] += 1
            }
            let desc = order.map { l in SpokenStrings.sceneCount(counts[l]!, label: l, language) }
                .joined(separator: SpokenStrings.sceneItemSeparator(language))
            parts.append(SpokenStrings.sceneZoneHas(zone: SpokenStrings.sceneZone(z, language), desc: desc, language))
        }
        return SpokenStrings.scenePrefix(language) + parts.joined(separator: SpokenStrings.scenePartSeparator(language))
    }
}
