import Foundation

/// 「我在哪」逆地理编码结果（与服务端 `/api/nav/whereami` 的 JSON 契约，见 amapClient.AmapReverseGeocode）。
/// 境内改用高德 regeo（比 Apple CLGeocoder 的中文地址更准更细、且带最近地标绝对方位）——数据源与
/// 「周围有什么」同因切到高德（境内 Apple 数据稀疏）。地址本身是中文街道门牌，**即便英文界面也保留原文**，
/// 因为盲人正是要把它念给出租车司机/路人/家人听（翻译成英文街名反而没人认得）。
public struct ReverseGeocode: Decodable, Equatable, Sendable {
    public struct Landmark: Decodable, Equatable, Sendable {
        public let name: String
        /// 高德绝对方位词（中文："东"/"东北"…，与用户朝向无关，便于转述）。空串=方位未知。
        public let direction: String
        public let distanceMeters: Double
        public init(name: String, direction: String, distanceMeters: Double) {
            self.name = name; self.direction = direction; self.distanceMeters = distanceMeters
        }
    }
    /// 最近路口/交叉口（两条相交路名 + 绝对方位 + 距离）：盲人定位与向路人/司机说明"在哪个路口"的天然锚点。
    public struct Intersection: Decodable, Equatable, Sendable {
        public let firstRoad: String
        public let secondRoad: String
        /// 高德绝对方位词（中文"东"/"东北"…，与用户朝向无关）。空串=方位未知。
        public let direction: String
        public let distanceMeters: Double
        public init(firstRoad: String, secondRoad: String, direction: String, distanceMeters: Double) {
            self.firstRoad = firstRoad; self.secondRoad = secondRoad; self.direction = direction; self.distanceMeters = distanceMeters
        }
    }
    /// 高德格式化完整地址（如"北京市朝阳区呼家楼街道…"）；无则空串。
    public let address: String
    /// 街道/乡镇（addressComponent.township）。空则空串。
    public let township: String
    /// 最近显著地标；缺则 nil。
    public let landmark: Landmark?
    /// 最近路口；缺则 nil。
    public let intersection: Intersection?
    public init(address: String, township: String, landmark: Landmark?, intersection: Intersection? = nil) {
        self.address = address; self.township = township; self.landmark = landmark; self.intersection = intersection
    }
}

/// 把服务端逆地理结果组织成可听播报（纯逻辑核，可单测）。
/// 只有**框架语**（"你大概在"/"最近的地标"）与**方位词**随界面语言本地化；中文地址原文始终保留。
public enum WhereAmIComposer {
    public static func compose(_ g: ReverseGeocode, language: Language, unit: DistanceUnit = .metric) -> String {
        let zh = language == .zh
        // 主体优先用完整地址，其次退到街道/乡镇。
        let body = !g.address.isEmpty ? g.address : g.township
        var out = ""
        if !body.isEmpty {
            out = (zh ? "你大概在：" : "You're near: ") + body
        }
        // 路口在地标之前：路口是更强的定向锚点（对标 Soundscape 优先播路口）。hasPrev=前面是否已有内容（决定用"。"接续还是起句）。
        if let clause = intersectionClause(g.intersection, zh: zh, hasPrev: !out.isEmpty, unit: unit) {
            out += clause
        }
        if let clause = landmarkClause(g.landmark, zh: zh, hasBody: !out.isEmpty, unit: unit) {
            out += clause
        }
        // 判据是「最终是否产出内容」，而非原始字段是否 nil：空/同名路口、空名地标等坏数据被 clause 剔成 nil 后
        // out 仍可能为空串——必须在此统一兜住，明确告知无法确定，**绝不播空串**（盲人会以为没响应）。
        return out.isEmpty ? (zh ? "无法确定当前位置" : "Can't determine your location") : out
    }

    private static func intersectionClause(_ x: ReverseGeocode.Intersection?, zh: Bool, hasPrev: Bool, unit: DistanceUnit) -> String? {
        guard let x = x, !x.firstRoad.isEmpty, !x.secondRoad.isEmpty else { return nil }
        // 同名两路不成"交叉口"：服务端已剔（amapClient first===second），但缓存/旧版服务端/他源数据仍可能带来
        // "X与X交叉口"——念给司机/路人毫无意义，此处渲染层再兜一道（防御纵深，与全库"未知/坏数据不外发"一致）。
        guard x.firstRoad.trimmingCharacters(in: .whitespaces) != x.secondRoad.trimmingCharacters(in: .whitespaces) else { return nil }
        let distStr = SpokenStrings.locationDistance(x.distanceMeters, zh ? .zh : .en, unit: unit) // 溢出安全 + ≥1km 用公里
        let dir = directionWord(x.direction, zh: zh)
        let lead = hasPrev ? (zh ? "。附近路口：" : ". Nearby intersection: ")
                           : (zh ? "附近路口：" : "Nearby intersection: ")
        if zh {
            return dir.isEmpty ? "\(lead)\(x.firstRoad)与\(x.secondRoad)交叉口，约\(distStr)"
                               : "\(lead)\(x.firstRoad)与\(x.secondRoad)交叉口，\(dir)约\(distStr)"
        } else {
            return dir.isEmpty ? "\(lead)\(x.firstRoad) and \(x.secondRoad), about \(distStr)"
                               : "\(lead)\(x.firstRoad) and \(x.secondRoad), \(dir) about \(distStr)"
        }
    }

    private static func landmarkClause(_ lm: ReverseGeocode.Landmark?, zh: Bool, hasBody: Bool, unit: DistanceUnit) -> String? {
        guard let lm = lm, !lm.name.isEmpty else { return nil }
        // 距离来自网络：巨值裸 Int(Double) 会陷阱崩溃。locationDistance 内部走 safeRoundedInt（溢出安全），且
        // ≥1km 用公里（"约1.5公里"远胜"约1500米"，rural 地标常上千米）——[[benchmark-rtt]] 溢出镜头 + 可听度。
        let distStr = SpokenStrings.locationDistance(lm.distanceMeters, zh ? .zh : .en, unit: unit)
        let dir = directionWord(lm.direction, zh: zh)
        // 有主体地址时用"。"接续；无主体（只有地标）时直接起句。
        let lead = hasBody ? (zh ? "。最近的地标：" : ". Nearest landmark: ")
                           : (zh ? "最近的地标：" : "Nearest landmark: ")
        if zh {
            // "银泰中心，东约50米" / 方位未知则省方位："银泰中心，约50米"
            return dir.isEmpty ? "\(lead)\(lm.name)，约\(distStr)"
                               : "\(lead)\(lm.name)，\(dir)约\(distStr)"
        } else {
            return dir.isEmpty ? "\(lead)\(lm.name), about \(distStr)"
                               : "\(lead)\(lm.name), \(dir) about \(distStr)"
        }
    }

    /// 高德绝对方位词 → 本地化。中文原样返回；英文按八方位翻译，**无法识别的方位一律返回空串**
    /// （绝不把生僻/异常的中文方位原文念给英文用户）。
    private static func directionWord(_ raw: String, zh: Bool) -> String {
        let d = raw.trimmingCharacters(in: .whitespaces)
        guard !d.isEmpty else { return "" }
        if zh {
            // 只放行标准八方位（含"正东/正北"等前缀归一），异常值省略免念脏数据。
            let normalized = d.replacingOccurrences(of: "正", with: "")
            return ["东", "南", "西", "北", "东北", "东南", "西北", "西南"].contains(normalized) ? normalized : ""
        }
        switch d.replacingOccurrences(of: "正", with: "") {
        case "东": return "east"
        case "南": return "south"
        case "西": return "west"
        case "北": return "north"
        case "东北": return "northeast"
        case "东南": return "southeast"
        case "西北": return "northwest"
        case "西南": return "southwest"
        default: return "" // 未知方位：英文侧省略，不外泄中文原文
        }
    }
}
