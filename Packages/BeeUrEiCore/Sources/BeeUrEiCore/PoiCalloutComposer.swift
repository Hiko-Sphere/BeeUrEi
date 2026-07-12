import Foundation

/// 「周围有什么」「前方有什么」的播报组织（Soundscape/BlindSquare 式环境播报的纯逻辑核）。
/// 把 POI 列表 + 相对朝向组织成一段中/英文时钟方位播报——此前这段过滤/排序/时钟/本地化逻辑内联在
/// `LocationDescriber`（App 层、无单测），提取到 core 后：① 可单测（时钟方位对盲人建立心理地图至关重要，
/// 说错方向 = 把人指向错的路口）；② 端侧 MapKit POI 与国内高德 POI **两条来源共用同一实现**，行为一致。
public enum PoiCalloutMode: Sendable, Equatable {
    case around // 四周（不限扇区）
    case ahead  // 仅朝向 ±50° 扇区内
}

/// 一条 POI 观测（已由调用方按各自坐标系算好距离与相对方位）。
public struct PoiObservation: Sendable, Equatable {
    public let name: String
    /// 直线距离（米）。
    public let distanceMeters: Double
    /// 相对用户朝向的方位角（度，规范化到 (-180,180]，0=正前、正=右手/顺时针）；nil=朝向不可用（罗盘未校准）。
    public let relativeBearingDegrees: Double?
    /// 地点类别中文（高德 type 末段，如"快餐厅""药店"）；nil/空=无（MapKit 境外源不提供）。帮盲人识别**品牌店**的
    /// 类型——名字是品牌（"肯德基"/"星巴克"）时听不出是什么，类别补齐"快餐厅"/"咖啡厅"。
    public let category: String?
    public init(name: String, distanceMeters: Double, relativeBearingDegrees: Double?, category: String? = nil) {
        self.name = name
        self.distanceMeters = distanceMeters
        self.relativeBearingDegrees = relativeBearingDegrees
        self.category = category
    }
}

public enum PoiCalloutComposer {
    /// 距用户过近（<5m，多半是所在建筑本身）不播；也过滤非有限距离/方位（坏定位不该崩或乱报）。
    private static let minDistanceMeters = 5.0

    /// 组织一段完整播报串。
    /// - pois: 候选 POI（顺序无所谓，内部按距离排序）。
    /// - mode: around=四周 / ahead=仅前方扇区。
    /// - radiusMeters: 检索半径（仅用于「没查到」文案，如"周围 250 米内没有查到地点"）。
    /// - headingAvailable: 罗盘是否可信（用于 ahead 无朝向时给"确定不了朝向"而非"前方没有地点"的准确文案）。
    /// - language: 播报语言。
    /// - maxCount: 最多播几条（默认 around 4 / ahead 3，听觉不宜过载）。
    public static func compose(pois: [PoiObservation],
                              mode: PoiCalloutMode,
                              radiusMeters: Int,
                              headingAvailable: Bool,
                              language: Language,
                              maxCount: Int? = nil,
                              unit: DistanceUnit = .metric) -> String {
        let zh = language == .zh
        var seenNames = Set<String>() // 同名去重（保留最近的那个）——听觉上重复念"全家便利店"是噪音
        var entries: [(text: String, dist: Double)] = []

        for poi in pois.sorted(by: { $0.distanceMeters < $1.distanceMeters }) {
            let name = poi.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { continue }
            let dist = poi.distanceMeters
            guard dist.isFinite, dist > minDistanceMeters else { continue }

            // 先算出这条**是否可播报**及其文案；去重登记留到**确定要 append 时**再做——
            // 否则一个被扇区/距离过滤掉的同名 POI（如正后方的"全家"）会先占掉去重名额，
            // 使一个真正在前方、该播的同名 POI 被当"已见"丢弃（盲人正走向它却听不到，安全攸关）。
            // locationDistance：溢出安全 + ≥1km 用公里（周边检索半径可达 3km，远处 POI"约2.1公里"远胜"约2100米"）。
            let dm = SpokenStrings.locationDistance(dist, zh ? .zh : .en, unit: unit)
            var phrase: String
            if let rel = poi.relativeBearingDegrees, rel.isFinite {
                if mode == .ahead, abs(rel) > 50 { continue } // 前方模式只留朝向 ±50° 扇区
                let hour = ClockDirection(angleDegrees: rel).hour
                phrase = zh ? "\(hour)点钟方向约\(dm)，\(name)"
                            : "\(name), about \(dm), \(hour) o'clock"
            } else {
                if mode == .ahead { continue } // 没有可信朝向，"前方"无从判定——下面给校准提示
                phrase = zh ? "约\(dm)，\(name)" : "\(name), about \(dm)"
            }
            // 类别补在名字后（帮盲人识别品牌店类型："肯德基，快餐厅"）：**仅中文**补——高德类别是中文，英文无对应，
            // 且英文嗓念中文类别=乱码。名字已含该类型词（"全家便利店"含"便利店"）则不重复。定向找某类走 nearest()，
            // 用户已知类型故那里不补。
            if zh, let cat = poi.category?.trimmingCharacters(in: .whitespacesAndNewlines), !cat.isEmpty, !name.contains(cat) {
                phrase += "，\(cat)"
            }

            guard seenNames.insert(name.lowercased()).inserted else { continue } // 同名只留首个**可播报**的（即最近的合格者）
            entries.append((phrase, dist))
        }

        let limit = maxCount ?? (mode == .ahead ? 3 : 4)
        let picked = entries.prefix(limit).map(\.text)

        if picked.isEmpty {
            switch mode {
            case .ahead:
                if !headingAvailable {
                    return zh ? "无法确定你的朝向，请稍后再试" : "Can't determine your heading — try again"
                }
                return zh ? "前方\(radiusMeters)米内没有查到地点"
                          : "No places found within \(radiusMeters) meters ahead"
            case .around:
                return zh ? "周围\(radiusMeters)米内没有查到地点"
                          : "No places found within \(radiusMeters) meters around you"
            }
        }

        let sep = zh ? "。" : ". "
        let prefix = mode == .ahead ? (zh ? "前方：" : "Ahead: ") : (zh ? "周围：" : "Around you: ")
        return prefix + picked.joined(separator: sep)
    }

    /// 就近找**单个**地点的播报（voice「最近的X」/"nearest X"）：从候选里挑最近的合格者
    /// （距离有限 >5m、名字非空），报店名 + 时钟方位 + 距离；无合格者 → "附近没找到<query>"。
    /// query=用户所问类别（"厕所"），name=实际店名——两者都念，盲人才知道到底是哪家。
    public static func nearest(from pois: [PoiObservation], query: String, radiusMeters: Int, language: Language, unit: DistanceUnit = .metric) -> String {
        let zh = language == .zh
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let best = pois
            .filter { $0.distanceMeters.isFinite && $0.distanceMeters > minDistanceMeters
                      && !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .min { $0.distanceMeters < $1.distanceMeters }
        guard let best else {
            return zh ? "附近\(radiusMeters)米内没找到\(q)" : "No \(q) found within \(radiusMeters) meters"
        }
        let name = best.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let dm = SpokenStrings.locationDistance(best.distanceMeters, zh ? .zh : .en, unit: unit) // 溢出安全 + ≥1km 用公里
        if let rel = best.relativeBearingDegrees, rel.isFinite {
            let hour = ClockDirection(angleDegrees: rel).hour
            return zh ? "最近的\(q)：\(name)，\(hour)点钟方向约\(dm)"
                      : "Nearest \(q): \(name), about \(dm), \(hour) o'clock"
        }
        return zh ? "最近的\(q)：\(name)，约\(dm)" : "Nearest \(q): \(name), about \(dm)"
    }
}
