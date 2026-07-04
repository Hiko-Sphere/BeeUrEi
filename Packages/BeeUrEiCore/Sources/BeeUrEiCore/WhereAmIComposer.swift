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
    /// 高德格式化完整地址（如"北京市朝阳区呼家楼街道…"）；无则空串。
    public let address: String
    /// 街道/乡镇（addressComponent.township）。空则空串。
    public let township: String
    /// 最近显著地标；缺则 nil。
    public let landmark: Landmark?
    public init(address: String, township: String, landmark: Landmark?) {
        self.address = address; self.township = township; self.landmark = landmark
    }
}

/// 把服务端逆地理结果组织成可听播报（纯逻辑核，可单测）。
/// 只有**框架语**（"你大概在"/"最近的地标"）与**方位词**随界面语言本地化；中文地址原文始终保留。
public enum WhereAmIComposer {
    public static func compose(_ g: ReverseGeocode, language: Language) -> String {
        let zh = language == .zh
        // 主体优先用完整地址，其次退到街道/乡镇。
        let body = !g.address.isEmpty ? g.address : g.township
        // 地址与地标都没有 → 明确告知无法确定，绝不播空串（盲人会以为没响应）。
        if body.isEmpty && g.landmark == nil {
            return zh ? "无法确定当前位置" : "Can't determine your location"
        }
        var out = ""
        if !body.isEmpty {
            out = (zh ? "你大概在：" : "You're near: ") + body
        }
        if let clause = landmarkClause(g.landmark, zh: zh, hasBody: !body.isEmpty) {
            out += clause
        }
        return out
    }

    private static func landmarkClause(_ lm: ReverseGeocode.Landmark?, zh: Bool, hasBody: Bool) -> String? {
        guard let lm = lm, !lm.name.isEmpty else { return nil }
        // 距离来自网络：巨值裸 Int(Double) 会陷阱崩溃，一律走 safeRoundedInt（[[benchmark-rtt]] 溢出镜头教训）。
        let meters = SpokenStrings.safeRoundedInt(lm.distanceMeters)
        let dir = directionWord(lm.direction, zh: zh)
        // 有主体地址时用"。"接续；无主体（只有地标）时直接起句。
        let lead = hasBody ? (zh ? "。最近的地标：" : ". Nearest landmark: ")
                           : (zh ? "最近的地标：" : "Nearest landmark: ")
        if zh {
            // "银泰中心，东约50米" / 方位未知则省方位："银泰中心，约50米"
            return dir.isEmpty ? "\(lead)\(lm.name)，约\(meters)米"
                               : "\(lead)\(lm.name)，\(dir)约\(meters)米"
        } else {
            return dir.isEmpty ? "\(lead)\(lm.name), about \(meters) m"
                               : "\(lead)\(lm.name), \(dir) about \(meters) m"
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
