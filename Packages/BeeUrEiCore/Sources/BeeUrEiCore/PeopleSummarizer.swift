import Foundation

/// 周围的人概述（纯逻辑，可单测）：人脸检测结果（横向位置 + 可选 LiDAR 距离）→ 一句话播报。
/// Seeing AI People 频道式，但只数人数、报方位与距离——不识别身份、不估年龄表情、不存任何人脸数据（隐私）。
/// 盲人高频场景：排队（前面有没有人）、会议室/候诊室（屋里几个人）、找同伴。
public struct PeopleSummarizer: Sendable {
    public init() {}

    /// people：每张脸的归一化横坐标（0=最左）与可选距离（米）。近的最重要：按近→远播报，无距离排最后。
    /// horizontalFOVDegrees：相机水平视场角（有真实内参时传 CameraFOV 计算值）。
    public func summary(people: [(normalizedX: Double, distanceMeters: Double?)],
                        horizontalFOVDegrees: Double = 68,
                        language: Language = .zh) -> String {
        guard !people.isEmpty else { return SpokenStrings.peopleNone(language) }
        let sorted = people.sorted { a, b in
            switch (a.distanceMeters, b.distanceMeters) {
            case let (x?, y?): return x < y
            case (.some, .none): return true
            case (.none, .some): return false
            case (.none, .none): return a.normalizedX < b.normalizedX // 无距离按横向位置稳定排序（确定性、可测）
            }
        }
        func direction(_ x: Double) -> String {
            SpokenStrings.coarseDirection(hour: ClockDirection(normalizedX: x,
                                                               horizontalFOVDegrees: horizontalFOVDegrees).hour,
                                          language)
        }
        let nearest = sorted[0]
        let nearestDist = nearest.distanceMeters.map { SpokenStrings.meters($0, language) }
        if sorted.count == 1 {
            return SpokenStrings.peopleOne(direction: direction(nearest.normalizedX),
                                           distance: nearestDist, language)
        }
        // 其余人只报方位；同方位去重、保持近→远顺序。
        var seen = Set<String>()
        var others: [String] = []
        for p in sorted.dropFirst() {
            let d = direction(p.normalizedX)
            if seen.insert(d).inserted { others.append(d) }
        }
        return SpokenStrings.peopleMany(count: sorted.count,
                                        nearestDirection: direction(nearest.normalizedX),
                                        nearestDistance: nearestDist,
                                        others: others, language)
    }
}
