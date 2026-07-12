import Foundation

/// 场景概述（纯逻辑，可单测）："前方有什么"——把检测到的物体按左/中/右分区、计数、汇总成一句话。
/// 盲人最常问的"前面是什么"。位置用检测框中心横坐标 0...1（左<0.4，右>0.6，其余中间）。
public struct SceneSummarizer: Sendable {
    public init() {}

    /// maxPerZone：每个分区最多播报的**物体种类数**。检测器不限个数（YOLO 一帧可出十几种），全列举会让盲人被
    /// 长清单淹没、抓不住重点。取每区最显著的几种（出现次数多的先报），其余以"等"带过。默认 3（听觉友好）。
    public func summary(objects: [(label: String, normalizedX: Double)], maxPerZone: Int = 3, language: Language = .zh) -> String {
        // 非有限横坐标（坏检测帧的 NaN/±inf）：位置未知，绝不塞进某分区谎报方位（NaN 会落进"中间"、+inf 落进
        // "右边"，把位置不明的物体说成确定方位误导盲人）。与全库"非有限未知不动作"一致（同 PeopleSummarizer 净化坏距离、
        // CompassRose 守卫坏方位角）。全被滤掉（整帧坏）则如实"没有识别到明显物体"。
        let objects = objects.filter { $0.normalizedX.isFinite }
        guard !objects.isEmpty else { return SpokenStrings.sceneEmpty(language) }
        func zone(_ x: Double) -> Int { x < 0.4 ? 0 : (x > 0.6 ? 2 : 1) }

        var parts: [String] = []
        for z in [1, 0, 2] { // 先中间，再左、右
            let labels = objects.filter { zone($0.normalizedX) == z }.map { $0.label }
            guard !labels.isEmpty else { continue }
            // 计数 + 记首次出现次序（并列时的稳定 tie-break，保证确定性、可测）。
            var order: [String] = []
            var counts: [String: Int] = [:]
            for l in labels {
                if counts[l] == nil { order.append(l) }
                counts[l, default: 0] += 1
            }
            // 按**显著度**排序：出现次数多的先报（一堆椅子比一个杯子更该先说），次数相同按首次出现（稳定）。
            let firstIndex = Dictionary(uniqueKeysWithValues: order.enumerated().map { ($0.element, $0.offset) })
            let ranked = order.sorted { a, b in
                counts[a]! != counts[b]! ? counts[a]! > counts[b]! : firstIndex[a]! < firstIndex[b]!
            }
            // 每区至多 maxPerZone 种，其余以"等"带过（听觉不宜过载）。maxPerZone<=0 视为不限（防呆）。
            let shown = maxPerZone > 0 ? Array(ranked.prefix(maxPerZone)) : ranked
            var desc = shown.map { l in SpokenStrings.sceneCount(counts[l]!, label: l, language) }
                .joined(separator: SpokenStrings.sceneItemSeparator(language))
            if shown.count < ranked.count { desc += SpokenStrings.sceneMore(language) }
            parts.append(SpokenStrings.sceneZoneHas(zone: SpokenStrings.sceneZone(z, language), desc: desc, language))
        }
        return SpokenStrings.scenePrefix(language) + parts.joined(separator: SpokenStrings.scenePartSeparator(language))
    }
}
